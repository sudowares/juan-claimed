import axios from "axios";

// Thin wrapper around every eGovPH API call this app makes. Nothing here knows about
// DimUser, JWTs, or app-level error codes (that's auth.service.ts's job) — this file only
// knows how to talk to eGov's HTTP API and throws EGOV_API_ERROR on failure, leaving the
// caller to decide what that means for its own flow.
//
// Docs: https://e.gov.ph/developers#api-tabs (eGovAPI Postman workspace, "Generate an eGov
// exchange code" request). EGOV_BASE_URL currently points at the hackathon sandbox
// (hackathon-sso.e.gov.ph); swapping to production later is just an env var change.
const EGOV_BASE_URL = process.env.EGOV_BASE_URL as string;
const EGOV_PARTNER_CODE = process.env.EGOV_PARTNER_CODE as string;
const EGOV_PARTNER_SECRET = process.env.EGOV_PARTNER_SECRET as string;

// eGov AI Core (translator, etc.) is a separate service from the SSO API above — its own
// base URL and its own token exchange (access_code -> bearer token, minted fresh per call
// since the AI Core API has no documented token lifetime to safely cache against).
const EGOV_AI_CORE_BASE_URL = process.env.EGOV_AI_CORE_BASE_URL as string;
const EGOV_AI_ACCESS_CODE = process.env.EGOV_AI_ACCESS_CODE as string;

// eMessage (SMS push) — yet another separate eGov service, own base URL, auth is a static
// long-lived access token (no token-exchange step like SSO/AI Core).
const EGOV_MESSAGE_BASE_URL = process.env.EGOV_MESSAGE_BASE_URL as string;
const EGOV_EMESSAGE_ACCESS_TOKEN = process.env.EGOV_EMESSAGE_ACCESS_TOKEN as string;

// Full shape of POST /api/partner/sso_authentication's "data" object — kept 1:1 with what
// eGov actually returns (not trimmed to what auth.service.ts happens to use today) so the
// raw profile can be handed to the frontend as-is for later use (KYC prefill, address sync,
// etc. — not decided yet, see loginWithEgov's egovProfile passthrough).
export interface EgovProfile {
  uniqid: string;
  email: string;
  birth_date?: string | null;
  first_name?: string;
  middle_name?: string | null;
  last_name?: string;
  suffix?: string | null;
  gender?: string | null;
  nationality?: string | null;
  photo?: string;
  mobile?: string | null;
  address?: string | null;
  street?: string | null;
  barangay?: string | null;
  municipality?: string | null;
  region?: string | null;
  province?: string | null;
  country?: string | null;
  country_alpha_2_code?: string | null;
  country_alpha_3_code?: string | null;
  postal?: string | null;
  address_line_2?: string | null;
  barangay_code?: string | null;
  province_code?: string | null;
  municipality_code?: string | null;
  region_code?: string | null;
  country_id?: number | null;
  foreign_address?: string | null;
  signature?: string | null;
  // Everything below sits under a nested "additional_information" block instead of the
  // flat fields above — see the team's field-mapping table (Marital Status, Religion,
  // Weight, Height, Educational Attainment, Industry, Salary Range, Occupation).
  additional_information?: EgovAdditionalInformation | null;
}

export interface EgovEducationalAttainmentEntry {
  level?: string | null;
  school?: string | null;
  from?: number | string | null;
  educational_background?: string | null;
  to?: number | string | null;
}

export interface EgovAdditionalInformation {
  other_personal_information?: {
    marital_status?: string | null;
    religion?: string | null;
  } | null;
  health_data?: {
    weight?: number | string | null;
    height?: number | string | null;
  } | null;
  educational_attainment?: EgovEducationalAttainmentEntry[] | null;
  occupation?: {
    occupation?: string | null;
  } | null;
  industry?: {
    industry?: string | null;
  } | null;
  expected_salary?: {
    expected_salary?: string | null;
  } | null;
}

const egovRequestFailed = (context: string, error: unknown): Error => {
  if (axios.isAxiosError(error)) {
    console.error(`[EgovApiService] ${context}:`, error.response?.status, error.response?.data);
  } else {
    console.error(`[EgovApiService] ${context}:`, error);
  }
  return new Error(`EGOV_API_ERROR: ${context}`);
};

// POST /api/token — exchange a one-time exchange_code (issued by the eGov app on the
// client) for a short-lived access_token scoped to SSO_AUTHENTICATION.
export const mintAccessToken = async (exchangeCode: string): Promise<string> => {
  let response;
  try {
    response = await axios.post(
      `${EGOV_BASE_URL}/api/token`,
      {
        exchange_code: exchangeCode,
        scope: "SSO_AUTHENTICATION",
        partner_code: EGOV_PARTNER_CODE,
        partner_secret: EGOV_PARTNER_SECRET,
      },
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    throw egovRequestFailed("eGov token exchange failed", error);
  }

  const accessToken = response.data?.access_token;
  if (!accessToken) {
    throw egovRequestFailed("eGov token exchange returned no access_token", response.data);
  }

  return accessToken as string;
};

// POST /api/partner/sso_authentication — resolve an access_token (from mintAccessToken)
// into the applicant's eGov identity/profile.
export const fetchProfile = async (accessToken: string): Promise<EgovProfile> => {
  let response;
  try {
    response = await axios.post(`${EGOV_BASE_URL}/api/partner/sso_authentication`, null, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error) {
    throw egovRequestFailed("eGov profile fetch failed", error);
  }

  const profile = response.data?.data as EgovProfile | undefined;
  if (!profile?.uniqid || !profile.email) {
    throw egovRequestFailed("eGov profile fetch returned an incomplete profile", response.data);
  }

  return profile;
};

// POST /api/v1/egov/integration/token — exchange the AI Core access_code for a bearer token
// used by every other AI Core endpoint (e.g. translateText below).
export const mintAiCoreAccessToken = async (): Promise<string> => {
  let response;
  try {
    response = await axios.post(
      `${EGOV_AI_CORE_BASE_URL}/api/v1/egov/integration/token`,
      { access_code: EGOV_AI_ACCESS_CODE },
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    throw egovRequestFailed("eGov AI Core token exchange failed", error);
  }

  const accessToken = response.data?.access_token ?? response.data?.data?.access_token;
  if (!accessToken) {
    throw egovRequestFailed("eGov AI Core token exchange returned no access_token", response.data);
  }

  return accessToken as string;
};

export interface EgovTranslation {
  original_prompt: string;
  source_lang: string;
  target_lang: string;
  translate_from: { code: string; label: string };
  translated_prompt: string;
  transliterated_prompt: string;
}

// POST /api/v1/egov/integration/translator/generate — translate/transliterate a short prompt
// between eGov's supported language codes (e.g. "en" <-> "fil").
export const translateText = async (prompt: string, sourceLang: string, targetLang: string): Promise<EgovTranslation> => {
  const accessToken = await mintAiCoreAccessToken();

  let response;
  try {
    response = await axios.post(
      `${EGOV_AI_CORE_BASE_URL}/api/v1/egov/integration/translator/generate`,
      { prompt, source_lang: sourceLang, target_lang: targetLang },
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } },
    );
  } catch (error) {
    throw egovRequestFailed("eGov AI Core translation failed", error);
  }

  const translation = response.data as EgovTranslation | undefined;
  if (!translation?.translated_prompt) {
    throw egovRequestFailed("eGov AI Core translation returned no translated_prompt", response.data);
  }

  return translation;
};

// POST /messaging/v1/sms/push — send a single SMS. No bulk-send endpoint exists yet, so
// callers wanting to notify many numbers must loop this one at a time (see
// benefitNotification.service.ts). Auth is the static access token passed in the
// `X-EMESSAGE-Auth` header (NOT an Authorization: Bearer — the gateway rejects that with
// 400 "token was not define in your request"). On success eGov returns 201 with
// { data: { message: "SMS was successfully created." } }.
export const sendSms = async (number: string, message: string): Promise<void> => {
  try {
    await axios.post(
      `${EGOV_MESSAGE_BASE_URL}/messaging/v1/sms/push`,
      { number, message },
      { headers: { "X-EMESSAGE-Auth": EGOV_EMESSAGE_ACCESS_TOKEN, "Content-Type": "application/json" } },
    );
  } catch (error) {
    throw egovRequestFailed(`eGov SMS push failed for ${number}`, error);
  }
};
