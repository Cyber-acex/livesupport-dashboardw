import * as z from "zod/v4";
import { MetadataDict, MetadataDict$Outbound } from "./metadatadict.js";
import { SpeechOutputFormat } from "./speechoutputformat.js";
export type SpeechRequest = {
    model?: string | null | undefined;
    metadata?: MetadataDict | null | undefined;
    stream?: boolean | undefined;
    /**
     * The preset or custom voice to use for generating the speech.
     */
    voiceId?: string | null | undefined;
    /**
     * The audio reference for generating the speech.
     */
    refAudio?: string | null | undefined;
    /**
     * Text to generate a speech from
     */
    input: string;
    responseFormat?: SpeechOutputFormat | undefined;
    [additionalProperties: string]: unknown;
};
/** @internal */
export type SpeechRequest$Outbound = {
    model?: string | null | undefined;
    metadata?: MetadataDict$Outbound | null | undefined;
    stream: boolean;
    voice_id?: string | null | undefined;
    ref_audio?: string | null | undefined;
    input: string;
    response_format?: string | undefined;
    [additionalProperties: string]: unknown;
};
/** @internal */
export declare const SpeechRequest$outboundSchema: z.ZodType<SpeechRequest$Outbound, SpeechRequest>;
export declare function speechRequestToJSON(speechRequest: SpeechRequest): string;
//# sourceMappingURL=speechrequest.d.ts.map