export interface KernelErrorInfo {
  code: string;
  operation?: string;
  message: string;
}

export class KernelError extends Error {
  readonly code: string;
  readonly operation?: string;

  constructor(info: KernelErrorInfo) {
    super(info.message);
    this.name = "KernelError";
    this.code = info.code;
    this.operation = info.operation;
  }
}

export class KernelInitializationError extends KernelError {
  constructor(message: string, code = "KERNEL_INITIALIZATION_FAILED") {
    super({ code, operation: "init", message });
    this.name = "KernelInitializationError";
  }
}

export class KernelOperationError extends KernelError {
  constructor(operation: string, message: string, code = "KERNEL_OPERATION_FAILED") {
    super({ code, operation, message });
    this.name = "KernelOperationError";
  }
}

export class KernelValidationError extends KernelError {
  constructor(operation: string, message: string, code = "KERNEL_VALIDATION_FAILED") {
    super({ code, operation, message });
    this.name = "KernelValidationError";
  }
}

export class KernelReferenceError extends KernelError {
  constructor(operation: string, message: string, code = "KERNEL_REFERENCE_INVALID") {
    super({ code, operation, message });
    this.name = "KernelReferenceError";
  }
}
