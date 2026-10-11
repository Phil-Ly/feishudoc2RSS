// Only these controlled messages may leave the application boundary.
export class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AppError';
    this.code = code;
  }
}

export function safeError(error) {
  return error instanceof AppError
    ? { code: error.code, message: error.message }
    : { code: 'INTERNAL_ERROR', message: '操作失败，请检查绑定、配置及服务状态。' };
}
