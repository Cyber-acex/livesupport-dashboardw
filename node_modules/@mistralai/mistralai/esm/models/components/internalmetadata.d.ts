import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
import { MirrorConfig, MirrorConfig$Outbound } from "./mirrorconfig.js";
export type InternalMetadataAgentVersion = string | number;
/**
 * Typed structure for internal metadata.
 */
export type InternalMetadata = {
    agentId?: string | null | undefined;
    agentVersion?: string | number | null | undefined;
    mirrorConfig?: MirrorConfig | null | undefined;
    scienceConfig?: {
        [k: string]: any;
    } | null | undefined;
    [additionalProperties: string]: unknown;
};
/** @internal */
export declare const InternalMetadataAgentVersion$inboundSchema: z.ZodType<InternalMetadataAgentVersion, unknown>;
/** @internal */
export type InternalMetadataAgentVersion$Outbound = string | number;
/** @internal */
export declare const InternalMetadataAgentVersion$outboundSchema: z.ZodType<InternalMetadataAgentVersion$Outbound, InternalMetadataAgentVersion>;
export declare function internalMetadataAgentVersionToJSON(internalMetadataAgentVersion: InternalMetadataAgentVersion): string;
export declare function internalMetadataAgentVersionFromJSON(jsonString: string): SafeParseResult<InternalMetadataAgentVersion, SDKValidationError>;
/** @internal */
export declare const InternalMetadata$inboundSchema: z.ZodType<InternalMetadata, unknown>;
/** @internal */
export type InternalMetadata$Outbound = {
    agent_id?: string | null | undefined;
    agent_version?: string | number | null | undefined;
    mirror_config?: MirrorConfig$Outbound | null | undefined;
    science_config?: {
        [k: string]: any;
    } | null | undefined;
    [additionalProperties: string]: unknown;
};
/** @internal */
export declare const InternalMetadata$outboundSchema: z.ZodType<InternalMetadata$Outbound, InternalMetadata>;
export declare function internalMetadataToJSON(internalMetadata: InternalMetadata): string;
export declare function internalMetadataFromJSON(jsonString: string): SafeParseResult<InternalMetadata, SDKValidationError>;
//# sourceMappingURL=internalmetadata.d.ts.map