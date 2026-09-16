import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { assessPackage } from "../dist/scan/riskSignals.js";

const npmFixture = JSON.parse(fs.readFileSync(new URL("../fixtures/npm-lodash-packument.json", import.meta.url)));
const pypiFixture = JSON.parse(fs.readFileSync(new URL("../fixtures/pypi-requests.json", import.meta.url)));

const ecosystem = (id, metadata, popularPackages = []) => ({ id, label: id, extensions: [], popularPackages, extractPackages: () => new Map(), fetchMetadata: async () => metadata });

test("recorded npm packument has per-version _npmUser identity", () => {
  assert.equal(npmFixture.versions["4.18.1"]._npmUser.name, "jdalton");
  assert.equal(npmFixture["dist-tags"].latest, "4.18.1");
});

test("recorded PyPI JSON has release upload times but no uploader identity", () => {
  assert.equal(pypiFixture.info.name, "requests");
  assert.equal(typeof pypiFixture.releases["2.9.2"][0].upload_time_iso_8601, "string");
  assert.equal("uploader" in pypiFixture.releases["2.9.2"][0], false);
});

test("dependency confusion requires high version plus thin recent history", async () => {
  const result = await assessPackage("internal-helper", ecosystem("npm", { existsOnRegistry: true, latestVersion: "999.0.0", releaseCount: 2, latestReleaseDaysAgo: 2 }));
  assert.equal(result?.verdict, "dependency-confusion-suspect");
  const boundary = await assessPackage("legitimate-v10", ecosystem("npm", { existsOnRegistry: true, latestVersion: "10.0.0", releaseCount: 4, latestReleaseDaysAgo: 2 }));
  assert.equal(boundary, null);
});

test("maintainer takeover requires popular install-base proxy and recent publisher change", async () => {
  const result = await assessPackage("lodash", ecosystem("npm", { existsOnRegistry: true, publisherHistory: ["jdalton", "new-account"], publisherChangedRecently: true, latestPublisher: "new-account", latestReleaseDaysAgo: 3 }, ["lodash"]));
  assert.equal(result?.verdict, "maintainer-takeover-suspect");
  const nonPopular = await assessPackage("private-name", ecosystem("npm", { existsOnRegistry: true, publisherHistory: ["old", "new"], publisherChangedRecently: true, latestPublisher: "new", latestReleaseDaysAgo: 3 }, ["lodash"]));
  assert.equal(nonPopular, null);
});
