export function cupsCommandEnvironment(baseEnvironment = process.env) {
  return {
    ...baseEnvironment,
    LANG: "C",
    LANGUAGE: "C",
    LC_ALL: "C",
  };
}

export function parsePrinterState(
  output,
  { locations = {}, preferredDefault = "" } = {},
) {
  const lines = output.split(/\r?\n/);
  const defaultLine = lines.find((line) =>
    line.startsWith("system default destination:"),
  );
  const systemDefault =
    defaultLine?.split(":").slice(1).join(":").trim() || "";
  const printers = lines
    .map((line) => line.match(/^printer\s+(\S+)\s+(.+)$/i))
    .filter(Boolean)
    .map((match) => {
      const name = match[1];
      const detail = match[2];
      return {
        name,
        location: locations[name] || "",
        isDefault: name === (preferredDefault || systemDefault),
        status: /disabled|not accepting|offline/i.test(detail)
          ? "offline"
          : "online",
      };
    });
  const defaultPrinter = preferredDefault || systemDefault || printers[0]?.name || "";

  return { printers, defaultPrinter };
}

export function parseCupsJobId(output) {
  return output.match(/request id is\s+(\S+)/i)?.[1] || "";
}
