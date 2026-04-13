import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
import { MirrorSource, MirrorSource$Outbound } from "./mirrorsource.js";
/**
 * Configuration for mirroring behavior.
 */
export type MirrorConfig = {
    /**
     * Source information for mirrored requests.
     */
    mirrorSource: MirrorSource;
};
/** @internal */
export declare const MirrorConfig$inboundSchema: z.ZodType<MirrorConfig, unknown>;
/** @internal */
export type MirrorConfig$Outbound = {
    mirror_source: MirrorSource$Outbound;
};
/** @internal */
export declare const MirrorConfig$outboundSchema: z.ZodType<MirrorConfig$Outbound, MirrorConfig>;
export declare function mirrorConfigToJSON(mirrorConfig: MirrorConfig): string;
export declare function mirrorConfigFromJSON(jsonString: string): SafeParseResult<MirrorConfig, SDKValidationError>;
//# sourceMappingURL=mirrorconfig.d.ts.map