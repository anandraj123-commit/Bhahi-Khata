import { isDeepStrictEqual } from "node:util";

export async function verifyPaymentIndexes(models) {
  for (const model of models) {
    const actual = await model.listIndexes();
    for (const [key, options] of model.schema.indexes().filter(([, options]) => options.unique)) {
      const index = actual.find(index => isDeepStrictEqual(index.key, key));
      if (!index?.unique || Boolean(index.sparse) !== Boolean(options.sparse) ||
          !isDeepStrictEqual(index.partialFilterExpression, options.partialFilterExpression))
        throw Object.assign(new Error(`Required unique index is unavailable for ${model.modelName}`),
          { code: "PAYMENT_INDEX_VERIFICATION_FAILED" });
    }
  }
}
