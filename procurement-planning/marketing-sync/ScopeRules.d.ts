export const MS_SCOPE_POLICY: string;
export type MaterialScope = {policy:string;kind:string;materials:string[];evidence:string;excludedMaterials:string[];hasExclusions:boolean};
export function marketingScopeAnalyze_(evidence:string): MaterialScope|null;
export function marketingScopeApply_<T extends Record<string,any>>(evidence:string,variant:T):T & {scopeGuard?:MaterialScope};
export function marketingScopeProduct_(product:{name?:string;category?:string;search?:string},scope?:MaterialScope|null):{eligible:boolean;uncertain:boolean;reason:string};
