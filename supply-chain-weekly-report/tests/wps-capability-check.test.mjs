import test from "node:test";
import assert from "node:assert/strict";

import {
  ConfigError,
  WpsProtocolError,
  buildListBody,
  createKsoHeaders,
  encodePathSegment,
  parseFieldsJson,
  readConfig,
  runCapabilityCheck,
} from "../scripts/wps-capability-check.mjs";

test("KSO-1 GET signature matches the official WPS example", () => {
  const headers = createKsoHeaders({
    accessKey: "AK123456",
    secretKey: "sk098765",
    method: "GET",
    requestUri: "/v7/test?key=value",
    contentType: "application/json",
    ksoDate: "Mon, 02 Jan 2006 15:04:05 GMT",
    requestBody: "",
  });

  assert.equal(headers["X-Kso-Date"], "Mon, 02 Jan 2006 15:04:05 GMT");
  assert.equal(
    headers["X-Kso-Authorization"],
    "KSO-1 AK123456:ce8df66877175e5198c8ea1362ffddf82e4941c6f25a4ca205a1ad09d0faaf03",
  );
});

test("KSO-1 POST signature matches the official WPS example", () => {
  const headers = createKsoHeaders({
    accessKey: "AK123456",
    secretKey: "sk098765",
    method: "POST",
    requestUri: "/v7/test/body",
    contentType: "application/json",
    ksoDate: "Mon, 02 Jan 2006 15:04:05 GMT",
    requestBody: '{"key": "value"}',
  });

  assert.equal(
    headers["X-Kso-Authorization"],
    "KSO-1 AK123456:c46e6c988130818ecba2484d51ac685948fbbef6814602c7874d6bfc41dc17b3",
  );
});

test("path segments are URL encoded independently", () => {
  assert.equal(encodePathSegment("文件 id/1"), "%E6%96%87%E4%BB%B6%20id%2F1");
});

test("list body uses safe read-only defaults", () => {
  assert.deepEqual(buildListBody(), {
    prefer_id: false,
    text_value: "original",
    page_size: 10,
    fields: [],
    show_record_extra_info: true,
    show_fields_info: true,
  });
});

test("WPS JSON-string fields are parsed", () => {
  assert.deepEqual(parseFieldsJson('{"名称":"测试","数量":1}'), {
    名称: "测试",
    数量: 1,
  });
});

test("invalid WPS fields payload raises a protocol error", () => {
  assert.throws(() => parseFieldsJson("not-json"), WpsProtocolError);
});

test("read config requires token, file id, and sheet id", () => {
  assert.throws(
    () => readConfig({}),
    (error) =>
      error instanceof ConfigError &&
      error.message.includes("WPS_ACCESS_TOKEN") &&
      error.message.includes("WPS_FILE_ID") &&
      error.message.includes("WPS_SHEET_ID"),
  );
});

test("signed requests require app id and secret", () => {
  assert.throws(
    () =>
      readConfig({
        WPS_ACCESS_TOKEN: "token",
        WPS_FILE_ID: "file",
        WPS_SHEET_ID: "3",
        WPS_SIGNING_ENABLED: "true",
      }),
    (error) =>
      error instanceof ConfigError &&
      error.message.includes("WPS_APP_ID") &&
      error.message.includes("WPS_APP_SECRET"),
  );
});

test("write mode requires both CLI and environment confirmation", () => {
  const config = readConfig({
    WPS_ACCESS_TOKEN: "token",
    WPS_FILE_ID: "file",
    WPS_SHEET_ID: "3",
    WPS_ALLOW_WRITE: "YES",
    WPS_TEST_TEXT_FIELD: "探针字段",
  });

  assert.equal(config.allowWrite, true);
  assert.equal(config.testTextField, "探针字段");
});

test("read-only check reports schema without exposing cell values", async () => {
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(
      JSON.stringify({
        code: 0,
        msg: "success",
        data: {
          fields_schema: [
            { id: "B", name: "名称", type: "MultiLineText" },
            { id: "C", name: "状态", type: "SingleSelect" },
          ],
          records: [
            {
              id: "rec001",
              fields: '{"名称":"不应输出的敏感内容","状态":"进行中"}',
            },
          ],
          page_token: "",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await runCapabilityCheck({
    config: {
      accessToken: "secret-token",
      fileId: "file/id",
      sheetId: 3,
      apiBase: "https://example.invalid",
      signingEnabled: false,
      appId: "",
      appSecret: "",
      allowWrite: false,
      testTextField: "",
      timeoutMs: 1_000,
    },
    fetchImpl: fakeFetch,
  });

  assert.equal(
    requests[0].url,
    "https://example.invalid/v7/coop/dbsheet/file%2Fid/sheets/3/records",
  );
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers.Authorization, "Bearer secret-token");
  assert.deepEqual(result.read.fieldsSchema, [
    { id: "B", name: "名称", type: "MultiLineText" },
    { id: "C", name: "状态", type: "SingleSelect" },
  ]);
  assert.doesNotMatch(JSON.stringify(result), /不应输出的敏感内容|secret-token/);
});

test("write check creates and updates one record without deleting it", async () => {
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, options });
    const path = new URL(url).pathname;
    let data;
    if (path.endsWith("/records/create")) {
      data = { records: [{ id: "probe-record", fields: "{}" }] };
    } else if (path.endsWith("/records/update")) {
      data = { records: [{ id: "probe-record", fields: "{}" }] };
    } else {
      data = { fields_schema: [], records: [], page_token: "" };
    }
    return new Response(JSON.stringify({ code: 0, msg: "success", data }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await runCapabilityCheck({
    config: {
      accessToken: "secret-token",
      fileId: "test-file",
      sheetId: 3,
      apiBase: "https://example.invalid",
      signingEnabled: false,
      appId: "",
      appSecret: "",
      allowWrite: true,
      testTextField: "探针字段",
      timeoutMs: 1_000,
    },
    write: true,
    fetchImpl: fakeFetch,
  });

  assert.equal(result.write.createdRecordId, "probe-record");
  assert.equal(result.write.updatedRecordId, "probe-record");
  assert.deepEqual(
    requests.map(({ url }) => new URL(url).pathname),
    [
      "/v7/coop/dbsheet/test-file/sheets/3/records",
      "/v7/coop/dbsheet/test-file/sheets/3/records/create",
      "/v7/coop/dbsheet/test-file/sheets/3/records/update",
    ],
  );
  assert.doesNotMatch(requests.map(({ url }) => url).join("\n"), /delete/);
});
