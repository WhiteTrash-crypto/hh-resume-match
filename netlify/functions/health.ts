import { json, withPublic } from './_lib'

export default withPublic(async () =>
  json({
    ok: true,
    netlify: process.env.NETLIFY || null,
    context: process.env.CONTEXT || null,
    hasLambda: Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME),
    time: new Date().toISOString(),
  }),
)
