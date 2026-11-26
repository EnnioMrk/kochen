import { describe, expect, it } from "vitest";
import { cookieSessionProblem } from "../src/platform-cookies";

const NETSCAPE = "# Netscape HTTP Cookie File\n.instagram.com\tTRUE\t/\tTRUE\t1893456000\tsessionid\tsecret\n";

describe("platform cookie sessions", () => {
  it("accepts a Netscape file with a session", () => {
    expect(cookieSessionProblem("instagram", NETSCAPE)).toBeNull();
  });

  it("rejects the two cookies a visitor gets before signing in", () => {
    const cookies = [
      "# Netscape HTTP Cookie File",
      ".instagram.com\tTRUE\t/\tTRUE\t1893456000\tcsrftoken\tabc",
      ".instagram.com\tTRUE\t/\tTRUE\t1893456000\tmid\tabc",
    ].join("\n");
    const problem = cookieSessionProblem("instagram", cookies);
    expect(problem).toContain("sessionid");
    expect(problem).toContain("instagram.com");
  });

  it("reads a JSON export", () => {
    const cookies = JSON.stringify([{ name: "sessionid", value: "x" }]);
    expect(cookieSessionProblem("instagram", cookies)).toBeNull();
  });

  it("reads a header line", () => {
    expect(cookieSessionProblem("tiktok", "sessionid=x; tt_csrf_token=y")).toBeNull();
    expect(cookieSessionProblem("youtube", "PREF=x")).toContain("SID");
  });
});
