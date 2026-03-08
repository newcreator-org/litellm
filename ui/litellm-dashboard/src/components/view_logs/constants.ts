import { getTranslation } from "@/i18n";

const t = getTranslation;

export const ERROR_CODE_OPTIONS: { label: string; value: string }[] = [
  { label: t("logs.errorCodes.badRequest"), value: "400" },
  { label: t("logs.errorCodes.invalidAuth"), value: "401" },
  { label: t("logs.errorCodes.permissionDenied"), value: "403" },
  { label: t("logs.errorCodes.notFound"), value: "404" },
  { label: t("logs.errorCodes.requestTimeout"), value: "408" },
  { label: t("logs.errorCodes.unprocessableEntity"), value: "422" },
  { label: t("logs.errorCodes.rateLimited"), value: "429" },
  { label: t("logs.errorCodes.internalServerError"), value: "500" },
  { label: t("logs.errorCodes.badGateway"), value: "502" },
  { label: t("logs.errorCodes.serviceUnavailable"), value: "503" },
  { label: t("logs.errorCodes.overloaded"), value: "529" },
];

/** Call types that represent MCP tool invocations (shared across columns, index, drawer). */
export const MCP_CALL_TYPES = ["call_mcp_tool", "list_mcp_tools"];

/** Call types that represent agent/A2A requests (e.g. asend_message). */
export const AGENT_CALL_TYPES = ["asend_message"];

export const QUICK_SELECT_OPTIONS: { label: string; value: number; unit: string }[] = [
  { label: t("logs.timeOptions.last15Minutes"), value: 15, unit: "minutes" },
  { label: t("logs.timeOptions.lastHour"), value: 1, unit: "hours" },
  { label: t("logs.timeOptions.last4Hours"), value: 4, unit: "hours" },
  { label: t("logs.timeOptions.last24Hours"), value: 24, unit: "hours" },
  { label: t("logs.timeOptions.last7Days"), value: 7, unit: "days" },
];
