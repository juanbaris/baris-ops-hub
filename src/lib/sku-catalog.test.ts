import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_NEW_SKUS } from "./sales-forecast";
import { EXTENDED_SKUS, SKU_FULL_NAMES } from "./sales-database";

describe("active flavor catalog", () => {
  test("discontinued Raspberry Yogurt (GR) is not an active flavor", () => {
    assert.equal((EXTENDED_SKUS as readonly string[]).includes("GR"), false);
    assert.equal(Object.hasOwn(SKU_FULL_NAMES, "GR"), false);
    assert.equal(DEFAULT_NEW_SKUS.some(sku => sku.name === "Raspberry Yogurt"), false);
  });

  test("discontinued Strawberry Yogurt (GS) is not an active flavor", () => {
    assert.equal((EXTENDED_SKUS as readonly string[]).includes("GS"), false);
    assert.equal(Object.hasOwn(SKU_FULL_NAMES, "GS"), false);
    assert.equal(DEFAULT_NEW_SKUS.some(sku => sku.name === "Strawberry Yogurt"), false);
  });

  test("remaining new flavors are Strawberry & White and Strawberry Caramel", () => {
    assert.deepEqual(DEFAULT_NEW_SKUS.map(sku => sku.name), ["Strawberry & White", "Strawberry Caramel"]);
    assert.ok(EXTENDED_SKUS.includes("DS"));
    assert.ok(EXTENDED_SKUS.includes("VS"));
    assert.ok(EXTENDED_SKUS.includes("CS"));
  });
});