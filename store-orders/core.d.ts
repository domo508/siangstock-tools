export const VERSION: string;
export const STORES: Record<string, string>;
export const STATUS: Record<string, string>;
export const PAYMENTS: string[];
export const POS_HEADERS: string[];
export const READ_OPTIONS: Record<string, unknown>;
export const WRITE_OPTIONS: Record<string, unknown>;
export function text(value: unknown): string;
export function taipeiDate(value?: string | Date): string;
export function validDate(value: string): boolean;
export function cents(value: unknown): number;
export function validateOrder(value: any, options?: {complete?: boolean}): {errors: string[]; warnings: string[]};
export function totals(order: any): Record<string, number>;
export function settlementSummary(orders: any[], exceptions?: any[]): Record<string, number>;

export function validStoreCode(code: unknown): boolean;

export function priceGroupValidation(order: any, complete?: boolean): {errors: string[]; warnings: string[]};

export function totalOnlyGroup(order: any, item: any): any;
export function useTotalOnlyGroups(order: any): any;
