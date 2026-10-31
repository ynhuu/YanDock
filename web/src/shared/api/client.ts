export class Unauthorized extends Error {}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function request(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
) {
  const isForm = body instanceof FormData
  const response = await fetch(`/api${path}`, {
    method,
    ...(signal ? { signal } : {}),
    credentials: 'same-origin',
    headers:
      body === undefined || isForm
        ? undefined
        : { 'Content-Type': 'application/json' },
    body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
  })
  if (!response.ok) {
    if (response.status === 401) throw new Unauthorized('请重新登录')
    throw new ApiError(
      (await response.text()).trim() || '请求失败',
      response.status,
    )
  }
  return response
}
