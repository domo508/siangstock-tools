export type Extraction = {header?:Record<string,unknown>;rows:Record<string,unknown>[];sharedPrices:Record<string,unknown>[];warnings:string[];[key:string]:unknown};
export const FULL_EXTRACTION_SCHEMA:Record<string,unknown>;
export const FULL_EXTRACTION_PROMPT:string;
export const CODED_GROUP_PROMPT:string;
export function validateExtraction(data:unknown):Extraction;
