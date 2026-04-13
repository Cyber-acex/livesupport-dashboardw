import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
import { InternalMetadata, InternalMetadata$Outbound } from "./internalmetadata.js";
/**
 * Custom type for metadata with embedded validation.
 */
export type MetadataDict = {
    internal?: InternalMetadata | null | undefined;
    [additionalProperties: string]: unknown;
};
/** @internal */
export declare const MetadataDict$inboundSchema: z.ZodType<MetadataDict, unknown>;
/** @internal */
export type MetadataDict$Outbound = {
    internal?: InternalMetadata$Outbound | null | undefined;
    [additionalProperties: string]: unknown;
};
/** @internal */
export declare const MetadataDict$outboundSchema: z.ZodType<MetadataDict$Outbound, MetadataDict>;
export declare function metadataDictToJSON(metadataDict: MetadataDict): string;
export declare function metadataDictFromJSON(jsonString: string): SafeParseResult<MetadataDict, SDKValidationError>;
//# sourceMappingURL=metadatadict.d.ts.map