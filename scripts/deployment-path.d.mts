export function deploymentName(value?: string): string;
export function deploymentPath(root: string, chainId: number | string, name?: string): string;
export function assertWritable(file: string, force?: boolean): void;
export function writeJson(file: string, value: unknown, force?: boolean): void;
