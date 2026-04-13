import * as z from "zod/v4";
import { Result as SafeParseResult } from "../../types/fp.js";
import { SDKValidationError } from "../errors/sdkvalidationerror.js";
/**
 * Source information for mirrored requests.
 */
export type MirrorSource = {
    app: string;
    version?: string | null | undefined;
    rootModelName: string;
    mirrorModelName: string;
    experimentId?: string | null | undefined;
};
/** @internal */
export declare const MirrorSource$inboundSchema: z.ZodType<MirrorSource, unknown>;
/** @internal */
export type MirrorSource$Outbound = {
    app: string;
    version?: string | null | undefined;
    root_model_name: string;
    mirror_model_name: string;
    experiment_id?: string | null | undefined;
};
/** @internal */
export declare const MirrorSource$outboundSchema: z.ZodType<MirrorSource$Outbound, MirrorSource>;
export declare function mirrorSourceToJSON(mirrorSource: MirrorSource): string;
export declare function mirrorSourceFromJSON(jsonString: string): SafeParseResult<MirrorSource, SDKValidationError>;
//# sourceMappingURL=mirrorsource.d.ts.map