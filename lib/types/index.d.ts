import type { IncomingMessage, ServerResponse } from 'node:http';
export declare const name = "dsh-file-review";
export declare const inject: string[];
interface WebRoute {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
}
interface WebServerLike {
    register(route: WebRoute): unknown;
}
interface SessionLike {
    header?: {
        cwd?: string;
    };
}
interface SessionsLike {
    get(sessionId: string): SessionLike | undefined;
}
interface LoggerLike {
    info?(msg: string, ...args: unknown[]): void;
    warn?(msg: string, ...args: unknown[]): void;
    error?(msg: string, ...args: unknown[]): void;
}
/**
 * Host 侧 SessionController：官方服务，`ctx.remote.session` 的 Host 实现。
 * prompt 会拒绝无文本无附件的内容，并对重复 requestId 幂等。
 */
interface SessionControllerLike {
    prompt(request: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}
interface HostContext {
    effect(fn: () => unknown, label?: string): unknown;
    webServer: WebServerLike;
    sessions: SessionsLike;
    sessionController: SessionControllerLike;
    get?(serviceName: string): unknown;
    webRuntime?: {
        trustedHosts?: readonly string[];
    };
    logger?: LoggerLike;
}
export declare function apply(ctx: HostContext): void;
export {};
