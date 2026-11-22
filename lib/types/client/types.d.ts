/** 客户端最小类型面（官方包不带 .d.ts，这里只声明我们用到的部分，避免运行时 import） */
export interface SlotRenderProps {
    sessionId?: string;
    inputActions?: {
        setDraft?(text: string): void;
        submit?(): void;
    };
    [key: string]: unknown;
}
export interface SlotsService {
    inject(slot: string, factory: () => unknown): void;
    register(options: {
        name: string;
        id: string;
        order?: number;
        label?: string;
        locale?: string;
        inject?: () => unknown;
    }, component: (props: SlotRenderProps) => unknown): unknown;
}
export interface PromptRequest {
    requestId: string;
    sessionId: string;
    mode: 'queue' | 'steer';
    content: readonly {
        type: 'text';
        text: string;
    }[];
    clientTimeZone?: string;
}
export interface RemoteService {
    session?: {
        prompt?: (request: PromptRequest, signal?: AbortSignal) => Promise<unknown>;
    };
}
export interface ClientContextLike {
    get(name: string): unknown;
    effect?(fn: () => unknown, label?: string): unknown;
    remote?: RemoteService;
}
