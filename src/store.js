// -----------------------------------------------------------------------------
// Dónde se guardan los hábitos. Hay dos implementaciones con la misma interfaz:
//
//   memoria  -> si DYNAMODB_TABLE está vacío (para probar en tu PC con npm start)
//   dynamodb -> si DYNAMODB_TABLE tiene el nombre de la tabla (en el clúster)
//
// En el clúster, DYNAMODB_TABLE llega desde el repo GitOps
// (lab-cfg-dm-argo-cd/lab-msa-dm-rachas/<env>/infrastructure.yaml -> ConfigMap)
// y la tabla la crea Terraform (lab-iac-do-k8s-demo/dynamodb.tf) con el MISMO nombre.
//
// Las credenciales de AWS NO están en el código ni en variables: el SDK las
// obtiene solo con IRSA (AWS_ROLE_ARN + AWS_WEB_IDENTITY_TOKEN_FILE, que EKS
// inyecta en el pod porque el ServiceAccount tiene la anotación del rol).
// -----------------------------------------------------------------------------

// Error que el servidor convierte en HTTP 409 (otro pod cambió el hábito a la vez).
export class ConflictoError extends Error {}

export function crearStore({ tabla, region }) {
  return tabla ? crearStoreDynamo(tabla, region) : crearStoreMemoria();
}

function crearStoreMemoria() {
  const habitos = new Map();

  return {
    descripcion: "memoria (se pierde al reiniciar el pod)",
    async ping() {},
    async listar() {
      return [...habitos.values()];
    },
    async obtener(id) {
      return habitos.get(id) ?? null;
    },
    async crear(habito) {
      if (habitos.has(habito.id)) throw new ConflictoError(`Ya existe ${habito.id}`);
      habitos.set(habito.id, habito);
    },
    async guardar(habito, totalDiasAnterior) {
      const actual = habitos.get(habito.id);
      if (!actual || actual.totalDias !== totalDiasAnterior) throw new ConflictoError("Cambió mientras tanto");
      habitos.set(habito.id, habito);
    },
    async borrar(id) {
      return habitos.delete(id);
    },
  };
}

async function crearStoreDynamo(tabla, region) {
  // Se importan solo si se usa DynamoDB: así "npm test" y el modo memoria
  // funcionan sin descargar el SDK de AWS.
  const { DynamoDBClient, DescribeTableCommand } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, ScanCommand, GetCommand, PutCommand, DeleteCommand } =
    await import("@aws-sdk/lib-dynamodb");

  const cliente = new DynamoDBClient({ region });
  const doc = DynamoDBDocumentClient.from(cliente);

  const traducirConflicto = (error) => {
    if (error.name === "ConditionalCheckFailedException") throw new ConflictoError(error.message);
    throw error;
  };

  return {
    descripcion: `dynamodb:${tabla}`,

    // Lo usa /ready: si el rol IRSA no tiene permiso o la tabla no existe,
    // el pod NO queda Ready y Kubernetes no le manda tráfico.
    async ping() {
      await cliente.send(new DescribeTableCommand({ TableName: tabla }));
    },

    async listar() {
      // Scan es aceptable en una tabla pequeña de laboratorio. En una tabla
      // real usarías Query con una clave de partición (por ejemplo, el usuario).
      const items = [];
      let ExclusiveStartKey;
      do {
        const respuesta = await doc.send(new ScanCommand({ TableName: tabla, ExclusiveStartKey }));
        items.push(...(respuesta.Items ?? []));
        ExclusiveStartKey = respuesta.LastEvaluatedKey;
      } while (ExclusiveStartKey);
      return items;
    },

    async obtener(id) {
      const respuesta = await doc.send(new GetCommand({ TableName: tabla, Key: { id } }));
      return respuesta.Item ?? null;
    },

    async crear(habito) {
      await doc
        .send(new PutCommand({
          TableName: tabla,
          Item: habito,
          ConditionExpression: "attribute_not_exists(id)",
        }))
        .catch(traducirConflicto);
    },

    // Escritura "optimista": solo guarda si nadie marcó el hábito desde que lo
    // leímos (totalDias sube en 1 con cada marca, así que sirve de "versión").
    // Con 2 réplicas, dos clics a la vez pueden llegar a pods distintos; la
    // condición evita que la racha suba dos veces.
    async guardar(habito, totalDiasAnterior) {
      await doc
        .send(new PutCommand({
          TableName: tabla,
          Item: habito,
          ConditionExpression: "totalDias = :anterior",
          ExpressionAttributeValues: { ":anterior": totalDiasAnterior },
        }))
        .catch(traducirConflicto);
    },

    async borrar(id) {
      const respuesta = await doc.send(new DeleteCommand({ TableName: tabla, Key: { id }, ReturnValues: "ALL_OLD" }));
      return Boolean(respuesta.Attributes);
    },
  };
}
