export type ComfyUIWorkflow = Record<string, ComfyUIWorkflowNode>;

export interface ComfyUIWorkflowNode {
  class_type: string;
  inputs: Record<string, ComfyUIInputValue>;
  _meta?: {
    title?: string;
  };
}

export type ComfyUIInputValue =
  | string
  | number
  | boolean
  | null
  | ComfyUIInputValue[]
  | { [key: string]: ComfyUIInputValue };

export interface QueuePromptRequest {
  prompt: ComfyUIWorkflow;
  client_id: string;
}

export interface QueuePromptResponse {
  prompt_id: string;
  number?: number;
  node_errors?: Record<string, unknown>;
}

export interface ComfyUIProgressMessage {
  type: "progress";
  data: {
    prompt_id: string;
    value: number;
    max: number;
    node?: string;
  };
}

export interface ComfyUIExecutingMessage {
  type: "executing";
  data: {
    prompt_id: string;
    node: string | null;
  };
}

export interface ComfyUIExecutedMessage {
  type: "executed";
  data: {
    prompt_id: string;
    node: string;
    output?: ComfyUIOutput;
  };
}

export interface ComfyUIExecutionErrorMessage {
  type: "execution_error";
  data: {
    prompt_id: string;
    node_id?: string;
    node_type?: string;
    exception_message: string;
    exception_type?: string;
    traceback?: string[];
  };
}

export type ComfyUIWebSocketMessage =
  | ComfyUIProgressMessage
  | ComfyUIExecutingMessage
  | ComfyUIExecutedMessage
  | ComfyUIExecutionErrorMessage;

export interface ComfyUIProgress {
  promptId: string;
  step: number;
  total: number;
  node?: string;
  previewUrl?: string;
  error?: string;
  completed: boolean;
}

export interface ComfyUIImageOutput {
  filename: string;
  subfolder: string;
  type: "input" | "output" | "temp";
}

export interface ComfyUIImageUploadResponse {
  name: string;
  subfolder: string;
  type: "input";
}

export interface ComfyUIOutput {
  images?: ComfyUIImageOutput[];
  [key: string]: unknown;
}

export interface ComfyUIHistoryEntry {
  prompt: [number, string, ComfyUIWorkflow, Record<string, unknown>, string[]];
  outputs: Record<string, ComfyUIOutput>;
  status: {
    status_str: string;
    completed: boolean;
    messages: Array<[string, Record<string, unknown>]>;
  };
}

export type ComfyUIHistory = Record<string, ComfyUIHistoryEntry | undefined>;

export type ComfyUIProgressCallback = (progress: ComfyUIProgress) => void;

export type UnsubscribeFn = () => void;

export interface ComfyUIReconnectOptions {
  maxRetries: number;
  backoffMs: readonly number[];
}
