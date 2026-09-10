import assert from "node:assert/strict";
import test from "node:test";
import {
  cupsCommandEnvironment,
  parseCupsJobId,
  parsePrinterState,
} from "../server/cups.mjs";

test("CUPS commands use a parse-stable locale on localized servers", () => {
  const environment = cupsCommandEnvironment({
    LANG: "zh_CN.UTF-8",
    LANGUAGE: "zh_CN:zh",
    LC_ALL: "zh_CN.UTF-8",
    CUPS_SERVER: "/var/run/cups/cups.sock",
  });

  assert.equal(environment.LANG, "C");
  assert.equal(environment.LANGUAGE, "C");
  assert.equal(environment.LC_ALL, "C");
  assert.equal(environment.CUPS_SERVER, "/var/run/cups/cups.sock");
});

test("parses real lpstat queues, status, location, and default", () => {
  const output = [
    "printer Office_Color is idle. enabled since Thu Sep 10 10:34:42 2026",
    "printer Paused_Queue disabled since Thu Sep 10 09:00:00 2026",
    "system default destination: Office_Color",
  ].join("\n");

  assert.deepEqual(
    parsePrinterState(output, {
      locations: { Office_Color: "5F east" },
    }),
    {
      printers: [
        {
          name: "Office_Color",
          location: "5F east",
          isDefault: true,
          status: "online",
        },
        {
          name: "Paused_Queue",
          location: "",
          isDefault: false,
          status: "offline",
        },
      ],
      defaultPrinter: "Office_Color",
    },
  );
});

test("parses CUPS request IDs used by progress monitoring", () => {
  assert.equal(
    parseCupsJobId("request id is RICOH_MP_C2504ex-42 (1 file(s))"),
    "RICOH_MP_C2504ex-42",
  );
});
