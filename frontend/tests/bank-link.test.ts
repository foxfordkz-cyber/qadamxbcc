import { deepStrictEqual } from "node:assert/strict";
import test from "node:test";
import { inspectBankLink } from "../src/lib/bank-link";

test("recognizes bcc.kz at a DNS label boundary and retains only the normalized host", () => {
  deepStrictEqual(inspectBankLink("  https://WWW.BCC.KZ.:443/login?code=example#account  "), { kind: "matches", host: "www.bcc.kz" });
  deepStrictEqual(inspectBankLink("bcc.kz"), { kind: "matches", host: "bcc.kz" });
  for (const host of ["bcc.kz.example", "otherbcc.kz", "example.org"]) {
    deepStrictEqual(inspectBankLink(`https://${host}/bcc.kz`), { kind: "external", host });
  }
});

test("warns about disguised authorities, explicit credentials, ports and plain HTTP", () => {
  for (const url of ["http://bcc.kz", "https://bcc.kz:8443", "https://name:password@bcc.kz", "https://%62cc.kz", "https://ｂｃｃ.kz"]) {
    deepStrictEqual(inspectBankLink(url), { kind: "unusual", host: "bcc.kz" });
  }
  deepStrictEqual(inspectBankLink("https://bcc.kz@outside.example/private"), { kind: "unusual", host: "outside.example" });
});

test("rejects incomplete, ambiguous, oversized or non-web addresses", () => {
  for (const value of ["", "https://", "//bcc.kz", "ftp://bcc.kz", "javascript:alert(0)", "https://bcc.kz\\other", "https://bcc.kz\u200b", "https://bcc.kz\n.example", "https://bcc..kz", "x".repeat(2100)]) {
    deepStrictEqual(inspectBankLink(value), { kind: "invalid" });
  }
});
