--!nocheck
--!nolint
--# selene: allow(global_usage, shadowing, unused_variable)
local tests_passed = 0
local tests_failed = 0

local function describe(name, callback)
	print("TEST SUITE: " .. name)
	callback()
end

local function it(name, callback)
	local success, err = pcall(callback)
	if success then
		print("  [PASS] " .. name)
		tests_passed += 1
	else
		print("  [FAIL] " .. name)
		print("         " .. tostring(err))
		tests_failed += 1
	end
end

local function expect(value)
	return {
		to_equal = function(expected)
			if value ~= expected then
				error(string.format("Expected %s, got %s", tostring(expected), tostring(value)))
			end
		end,
		to_be_truthy = function()
			if not value then
				error(string.format("Expected truthy value, got %s", tostring(value)))
			end
		end,
		to_be_falsy = function()
			if value then
				error(string.format("Expected falsy value, got %s", tostring(value)))
			end
		end,
		to_contain = function(expected)
			if type(value) ~= "string" or not string.find(value, expected, 1, true) then
				error(
					string.format("Expected %s to contain %s", tostring(value), tostring(expected))
				)
			end
		end,
	}
end

local warnedMessages = {}

-- Stock luau has no `warn`, and every included file routes `[Warning]` messages
-- through it (see logToPlugin in src/ui/gui.luau). Capture instead of print so
-- the re-entrancy guards can be asserted on. Declared as a local rather than a
-- global so both stock luau and Selene are happy with it.
local warn = function(...)
	local parts = {}
	for index = 1, select("#", ...) do
		parts[index] = tostring(select(index, ...))
	end
	table.insert(warnedMessages, table.concat(parts, " "))
end

local function captureWarnings(callback)
	local first = #warnedMessages + 1
	callback()
	return table.concat(warnedMessages, "\n", first, #warnedMessages)
end

local function newMockInstance(className, name)
	return {
		ClassName = className,
		Name = name,
		Parent = { ClassName = "Workspace" },
		GetFullName = function(self)
			return "Workspace." .. tostring(self.Name)
		end,
	}
end

local plugin = {
	CreateToolbar = function(_self, _name)
		return {
			CreateButton = function(_selfBtn, _id, _tooltip, _icon)
				return {
					Click = {
						Connect = function() end,
					},
				}
			end,
		}
	end,
	Unloading = {
		Connect = function() end,
	},
}

local function mockSignal()
	local signal = {
		_handlers = {},
		Connect = function(self, callback)
			table.insert(self._handlers, callback)
			return { Disconnect = function() end }
		end,
		Fire = function(self, ...)
			for _, callback in ipairs(self._handlers) do
				callback(...)
			end
		end,
	}
	return signal
end

local game = {
	GetService = function(_self, serviceName)
		if serviceName == "HttpService" then
			return {
				RequestAsync = function()
					return { Success = true, StatusCode = 200, Body = "{}" }
				end,
				JSONEncode = function(_s, _t)
					return "{}"
				end,
				JSONDecode = function(_s, _str)
					return {}
				end,
				GenerateGUID = function()
					return "00000000-0000-0000-0000-000000000000"
				end,
			}
		elseif serviceName == "RunService" then
			return {
				IsStudio = function()
					return true
				end,
				IsServer = function()
					return false
				end,
			}
		elseif serviceName == "LogService" then
			return { MessageOut = mockSignal() }
		elseif serviceName == "UserInputService" then
			return { InputChanged = mockSignal(), InputEnded = mockSignal() }
		end
		return {}
	end,
}

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")
local CollectionService = {
	GetTags = function()
		return {}
	end,
	AddTag = function() end,
	RemoveTag = function() end,
}
local ChangeHistoryService = {
	TryBeginRecording = function()
		return {}
	end,
	FinishRecording = function() end,
}
local AssetService = {}
local ScriptEditorService = {}
local task = { wait = function() end }

local startPolling: any
local hidePluginGui: any
local togglePluginGui: any
local logToPlugin: any
local polling: any
local BASE_URL: any

--#include "../src/config/runtime.luau"
--#include "../src/ui/gui.luau"
--#include "../src/types/assets.luau"
--#include "../src/state/registry.luau"
--#include "../src/util/assets.luau"
--#include "../src/net/http.luau"
--#include "../src/scan/properties.luau"
--#include "../src/scan/scanner.luau"
--#include "../src/patch/mesh.luau"
--#include "../src/patch/patcher.luau"
--#include "../src/bridge/discovery.luau"
--#include "../src/bridge/polling.luau"

describe("Plugin Initialization", function()
	it("should provide mock plugin object", function()
		expect(plugin ~= nil).to_be_truthy()
	end)

	it("should simulate game services correctly", function()
		local http = game:GetService("HttpService")
		expect(http ~= nil).to_be_truthy()
		expect(type(http.RequestAsync) == "function").to_be_truthy()
	end)
end)

describe("registry.luau", function()
	it("should register and retrieve objects via token", function()
		local mockInstance = { ClassName = "Part", Parent = {} }
		local token = registerObject(mockInstance)

		expect(token ~= nil).to_be_truthy()
		expect(type(token) == "string").to_be_truthy()

		local retrieved = getRegisteredObject(token)
		expect(retrieved.ClassName).to_equal("Part")
	end)

	it("should handle destroyed objects by returning nil", function()
		local mockInstance = { ClassName = "Part", Parent = {} }
		local token = registerObject(mockInstance)

		mockInstance.Parent = nil
		expect(getRegisteredObject(token) == nil).to_be_truthy()
	end)
end)

describe("patcher.luau", function()
	it("should extract asset IDs correctly", function()
		expect(normalizeAssetId("rbxassetid://12345")).to_equal("12345")
		expect(normalizeAssetId("12345")).to_equal("12345")
		expect(normalizeAssetId("roblox.com/asset/?id=54321&version=1")).to_equal("54321")
	end)

	it("should rewrite isolated asset IDs in every literal form", function()
		expect(replaceAssetIdToken("local a = 12345", "12345", "67890")).to_equal("local a = 67890")
		expect(replaceAssetIdToken('"rbxassetid://12345"', "12345", "67890")).to_equal(
			'"rbxassetid://67890"'
		)
		expect(replaceAssetIdToken("{AnimationId = 12345}", "12345", "67890")).to_equal(
			"{AnimationId = 67890}"
		)
		expect(replaceAssetIdToken('"roblox.com/asset/?id=12345"', "12345", "67890")).to_equal(
			'"roblox.com/asset/?id=67890"'
		)
	end)

	it("should leave longer IDs and identifiers untouched", function()
		-- A bare ID match used to corrupt these: 12345 inside 123456 rewrote the
		-- longer ID's tail, turning rbxassetid://123456 into rbxassetid://678906.
		expect(replaceAssetIdToken('"rbxassetid://123456"', "12345", "67890")).to_equal(
			'"rbxassetid://123456"'
		)
		expect(replaceAssetIdToken('"roblox.com/asset/?id=123456"', "12345", "67890")).to_equal(
			'"roblox.com/asset/?id=123456"'
		)
		expect(replaceAssetIdToken('"rbxassetid://12345ab"', "12345", "67890")).to_equal(
			'"rbxassetid://12345ab"'
		)
		expect(replaceAssetIdToken("local a = 12345ab", "12345", "67890")).to_equal(
			"local a = 12345ab"
		)
		expect(replaceAssetIdToken("local a = 912345", "12345", "67890")).to_equal(
			"local a = 912345"
		)
	end)

	it("should rewrite every occurrence in a single pass", function()
		local source = 'local a = 12345\nlocal b = 12345\nlocal c = "rbxassetid://12345"'
		local expected = 'local a = 67890\nlocal b = 67890\nlocal c = "rbxassetid://67890"'
		expect(replaceAssetIdToken(source, "12345", "67890")).to_equal(expected)
	end)

	it("should reject invalid patch actions", function()
		local patch, err = normalizePatch({ token = "1", action = "invalidAction" })
		expect(patch == nil).to_be_truthy()
	end)
end)

describe("properties.luau", function()
	it("should correctly identify property text limits using real constants", function()
		expect(getMaxRecordValueBytes("Source")).to_equal(MAX_SCRIPT_SOURCE_BYTES)
		expect(getMaxRecordValueBytes("Text")).to_equal(MAX_RECORD_TEXT_VALUE_BYTES)
		expect(getMaxRecordValueBytes("MeshId")).to_equal(MAX_RECORD_VALUE_BYTES)
	end)

	it("should return the exact limit for every property family", function()
		expect(getMaxRecordValueBytes("Source")).to_equal(8000000)
		for _, property in ipairs({ "Text", "PlaceholderText", "ToolTip", "Value" }) do
			expect(getMaxRecordValueBytes(property)).to_equal(100000)
		end
		for _, property in ipairs({ "MeshId", "Name", "Image", "unknownProperty" }) do
			expect(getMaxRecordValueBytes(property)).to_equal(1000000)
		end
	end)

	it("should accept a value exactly at the limit and reject one byte over", function()
		local obj = newMockInstance("TextLabel", "BoundaryLabel")

		local function addedFor(property, bytes)
			resetScanRecordState()
			local records = {}
			local added = addRecord(records, obj, property, string.rep("a", bytes))
			return added, #records
		end

		local sourceOk, sourceCount = addedFor("Source", MAX_SCRIPT_SOURCE_BYTES)
		expect(sourceOk > 0).to_be_truthy()
		expect(sourceCount).to_equal(1)

		local sourceOver, sourceOverCount = addedFor("Source", MAX_SCRIPT_SOURCE_BYTES + 1)
		expect(sourceOver).to_equal(0)
		expect(sourceOverCount).to_equal(0)

		local textOk, textCount = addedFor("Text", MAX_RECORD_TEXT_VALUE_BYTES)
		expect(textOk > 0).to_be_truthy()
		expect(textCount).to_equal(1)

		local textOver, textOverCount = addedFor("Text", MAX_RECORD_TEXT_VALUE_BYTES + 1)
		expect(textOver).to_equal(0)
		expect(textOverCount).to_equal(0)

		local defaultOk, defaultCount = addedFor("MeshId", MAX_RECORD_VALUE_BYTES)
		expect(defaultOk > 0).to_be_truthy()
		expect(defaultCount).to_equal(1)

		local defaultOver, defaultOverCount = addedFor("MeshId", MAX_RECORD_VALUE_BYTES + 1)
		expect(defaultOver).to_equal(0)
		expect(defaultOverCount).to_equal(0)

		resetScanRecordState()
	end)

	it("should safely extract metadata without throwing", function()
		local obj = {
			ClassName = "Part",
			Name = "TestPart",
			GetFullName = function()
				return "Workspace.TestPart"
			end,
		}
		expect(obj.ClassName).to_equal("Part")
		expect(obj.Name).to_equal("TestPart")
		expect(obj.GetFullName()).to_equal("Workspace.TestPart")
	end)
end)

describe("scanner.luau validScannedTags", function()
	it("should reject non-table and empty tag lists", function()
		expect(validScannedTags(nil)).to_be_falsy()
		expect(validScannedTags("12345")).to_be_falsy()
		expect(validScannedTags(12345)).to_be_falsy()
		expect(validScannedTags(false)).to_be_falsy()
		expect(validScannedTags({})).to_be_falsy()
	end)

	it("should enforce the maximum tag count", function()
		local atLimit = {}
		for index = 1, MAX_TAGS_PER_OBJECT do
			atLimit[index] = "tag" .. index
		end
		expect(#atLimit).to_equal(100)
		expect(validScannedTags(atLimit)).to_be_truthy()

		local overLimit = {}
		for index = 1, MAX_TAGS_PER_OBJECT + 1 do
			overLimit[index] = "tag" .. index
		end
		expect(validScannedTags(overLimit)).to_be_falsy()
	end)

	it("should enforce the maximum tag length in bytes", function()
		local atLimit = { string.rep("t", MAX_TAG_BYTES) }
		expect(#atLimit[1]).to_equal(100)
		expect(validScannedTags(atLimit)).to_be_truthy()

		local overLimit = { string.rep("t", MAX_TAG_BYTES + 1) }
		expect(validScannedTags(overLimit)).to_be_falsy()
	end)

	it("should reject non-string and empty tags", function()
		expect(validScannedTags({ 12345 })).to_be_falsy()
		expect(validScannedTags({ "valid", 12345 })).to_be_falsy()
		expect(validScannedTags({ nil })).to_be_falsy()
		expect(validScannedTags({ "" })).to_be_falsy()
		expect(validScannedTags({ "valid", "" })).to_be_falsy()
	end)

	it("should accept a valid tag list", function()
		expect(validScannedTags({ "rbxassetid://12345" })).to_be_truthy()
		expect(validScannedTags({ "a", "b", "c" })).to_be_truthy()
	end)
end)

describe("patcher.luau normalizePatch rejections", function()
	it("should refuse a non-table patch", function()
		local patch, err = normalizePatch("not a patch")
		expect(patch).to_be_falsy()
		expect(err).to_contain("must be a table")
	end)

	it("should refuse a patch with a missing or empty token", function()
		local patch, err = normalizePatch({ action = "setProperty", property = "Name", value = 1 })
		expect(patch).to_be_falsy()
		expect(err).to_contain("missing token")

		local emptyPatch, emptyErr =
			normalizePatch({ token = "", action = "setProperty", property = "Name", value = 1 })
		expect(emptyPatch).to_be_falsy()
		expect(emptyErr).to_contain("missing token")
	end)

	it("should refuse a patch with a missing or non-string action", function()
		local missing, missingErr = normalizePatch({ token = "1" })
		expect(missing).to_be_falsy()
		expect(missingErr).to_contain("missing action")

		local numeric, numericErr = normalizePatch({ token = "1", action = 42 })
		expect(numeric).to_be_falsy()
		expect(numericErr).to_contain("missing action")
	end)

	it("should refuse unknown patch actions", function()
		local patch, err = normalizePatch({ token = "1", action = "deleteEverything" })
		expect(patch).to_be_falsy()
		expect(err).to_contain("Unsupported patch action")
	end)

	it(
		"should accept a blocked property name at parse time, refusing it only in applyPatch",
		function()
			-- normalizePatch is deliberately not the gate for BLOCKED_SET_PROPERTIES:
			-- the refusal happens in applyPatch so the error can name the token.
			local parent, parentErr = normalizePatch({
				token = "1",
				action = "setProperty",
				property = "Parent",
				value = {},
			})
			expect(parent == nil).to_be_falsy()
			expect(parentErr == nil).to_be_truthy()
		end
	)

	it("should refuse a property-less or malformed property name", function()
		local noProperty, noPropertyErr =
			normalizePatch({ token = "1", action = "setProperty", value = "x" })
		expect(noProperty).to_be_falsy()
		expect(noPropertyErr).to_contain("requires a property name")

		local emptyProperty, emptyPropertyErr =
			normalizePatch({ token = "1", action = "setProperty", property = "", value = "x" })
		expect(emptyProperty).to_be_falsy()
		expect(emptyPropertyErr).to_contain("Invalid patch property")

		local nulProperty, nulPropertyErr = normalizePatch({
			token = "1",
			action = "setProperty",
			property = "Name\0Injected",
			value = "x",
		})
		expect(nulProperty).to_be_falsy()
		expect(nulPropertyErr).to_contain("Invalid patch property")

		local longProperty, longPropertyErr = normalizePatch({
			token = "1",
			action = "setProperty",
			property = string.rep("p", 201),
			value = "x",
		})
		expect(longProperty).to_be_falsy()
		expect(longPropertyErr).to_contain("Invalid patch property")
	end)
end)

describe("patcher.luau applyPatch rejections", function()
	it("should refuse setProperty for Parent, ClassName and Source", function()
		for _, property in ipairs({ "Parent", "ClassName", "Source" }) do
			local obj = newMockInstance("Part", "Blocked" .. property)
			local token = registerObject(obj)
			local ok, applied, err = pcall(applyPatch, {
				token = token,
				action = "setProperty",
				property = property,
				value = "should-not-stick",
			})

			expect(ok).to_be_truthy()
			expect(applied).to_be_falsy()
			expect(err).to_contain("Property cannot be set with setProperty")
			expect(obj.Parent ~= nil).to_be_truthy()
			expect(obj.ClassName).to_equal("Part")
			expect(obj.Source).to_be_falsy()
		end
	end)

	it("should still apply a permitted setProperty", function()
		local obj = newMockInstance("Part", "Permitted")
		local token = registerObject(obj)
		local ok, applied = pcall(applyPatch, {
			token = token,
			action = "setProperty",
			property = "Name",
			value = "Renamed",
		})

		expect(ok).to_be_truthy()
		expect(applied).to_be_truthy()
		expect(obj.Name).to_equal("Renamed")
	end)

	it(
		"should return the scan-again error for an unresolvable token instead of throwing",
		function()
			for _, badToken in ipairs({ "0:missing", "not-a-real-token" }) do
				local ok, applied, err = pcall(applyPatch, {
					token = badToken,
					action = "setProperty",
					property = "Name",
					value = "x",
				})

				expect(ok).to_be_truthy()
				expect(applied).to_be_falsy()
				expect(err).to_contain("scan again")
			end
		end
	)

	it("should refuse a non-string token that cannot resolve", function()
		local normalized = normalizePatch({ token = 0, action = "setProperty", property = "Name" })
		expect(normalized.token).to_equal("0")

		local ok, applied, err = pcall(applyPatch, {
			token = normalized.token,
			action = "setProperty",
			property = "Name",
			value = "x",
		})
		expect(ok).to_be_truthy()
		expect(applied).to_be_falsy()
		expect(err).to_contain("scan again")
	end)

	it("should return a failure for an unknown action rather than throwing", function()
		local obj = newMockInstance("Part", "UnknownAction")
		local token = registerObject(obj)
		local ok, applied, err = pcall(applyPatch, {
			token = token,
			action = "selfDestruct",
			property = "",
			value = nil,
		})

		expect(ok).to_be_truthy()
		expect(applied).to_be_falsy()
		expect(err).to_contain("Unsupported patch action")
	end)
end)

describe("patcher.luau replaceAssetIdToken", function()
	it("should rewrite every roblox.com/asset/?id= casing", function()
		expect(replaceAssetIdToken("roblox.com/asset/?id=12345", "12345", "67890")).to_equal(
			"roblox.com/asset/?id=67890"
		)
		expect(replaceAssetIdToken("roblox.com/asset/?ID=12345", "12345", "67890")).to_equal(
			"roblox.com/asset/?ID=67890"
		)
		expect(replaceAssetIdToken("roblox.com/Asset/?Id=12345", "12345", "67890")).to_equal(
			"roblox.com/Asset/?Id=67890"
		)
		expect(replaceAssetIdToken("roblox.com/ASSET/?ID=12345", "12345", "67890")).to_equal(
			"roblox.com/ASSET/?ID=67890"
		)
		expect(replaceAssetIdToken('"roblox.com/asset/?id=12345&version=2"', "12345", "67890")).to_equal(
			'"roblox.com/asset/?id=67890&version=2"'
		)
	end)

	it("should rewrite after =, {, comma, ( and whitespace prefixes", function()
		expect(replaceAssetIdToken("local a = 12345", "12345", "67890")).to_equal("local a = 67890")
		expect(replaceAssetIdToken("{12345}", "12345", "67890")).to_equal("{67890}")
		expect(replaceAssetIdToken(",12345", "12345", "67890")).to_equal(",67890")
		expect(replaceAssetIdToken("a,12345", "12345", "67890")).to_equal("a,67890")
		expect(replaceAssetIdToken("f(12345)", "12345", "67890")).to_equal("f(67890)")
		expect(replaceAssetIdToken("  12345", "12345", "67890")).to_equal("  67890")
		expect(replaceAssetIdToken('"12345"', "12345", "67890")).to_equal('"67890"')
		expect(replaceAssetIdToken("rbxassetid://12345", "12345", "67890")).to_equal(
			"rbxassetid://67890"
		)
	end)

	it("should leave identifier-like continuations and longer numbers alone", function()
		expect(replaceAssetIdToken("local a = 12345ab", "12345", "67890")).to_equal(
			"local a = 12345ab"
		)
		expect(replaceAssetIdToken('"rbxassetid://12345ab"', "12345", "67890")).to_equal(
			'"rbxassetid://12345ab"'
		)
		expect(replaceAssetIdToken("local a = 912345", "12345", "67890")).to_equal(
			"local a = 912345"
		)
		expect(replaceAssetIdToken("local a = 123459", "12345", "67890")).to_equal(
			"local a = 123459"
		)
		expect(replaceAssetIdToken("local a = 1234512", "12345", "67890")).to_equal(
			"local a = 1234512"
		)
	end)

	it("should leave hex and bare literals without a separator prefix alone", function()
		expect(replaceAssetIdToken("local a = 0x12345", "12345", "67890")).to_equal(
			"local a = 0x12345"
		)
		expect(replaceAssetIdToken("local a = bar12345", "12345", "67890")).to_equal(
			"local a = bar12345"
		)
		expect(replaceAssetIdToken("", "12345", "67890")).to_equal("")
	end)
end)

describe("polling.luau operationBusy", function()
	it("should report busy for every running-operation combination", function()
		local previousScan, previousPatch, previousManual =
			scanRunning, patchRunning, manualReplaceRunning

		local cases = {
			{ scan = false, patch = false, manual = false, expected = false },
			{ scan = true, patch = false, manual = false, expected = true },
			{ scan = false, patch = true, manual = false, expected = true },
			{ scan = false, patch = false, manual = true, expected = true },
			{ scan = true, patch = true, manual = false, expected = true },
			{ scan = true, patch = false, manual = true, expected = true },
			{ scan = false, patch = true, manual = true, expected = true },
			{ scan = true, patch = true, manual = true, expected = true },
		}

		for _, case in ipairs(cases) do
			scanRunning = case.scan
			patchRunning = case.patch
			manualReplaceRunning = case.manual

			local busy = operationBusy()
			if busy ~= case.expected then
				error(
					string.format(
						"operationBusy() with scan=%s patch=%s manual=%s: expected %s, got %s",
						tostring(case.scan),
						tostring(case.patch),
						tostring(case.manual),
						tostring(case.expected),
						tostring(busy)
					)
				)
			end
		end

		scanRunning, patchRunning, manualReplaceRunning =
			previousScan, previousPatch, previousManual
	end)
end)

describe("scanner.luau scan re-entrancy guard", function()
	it("should warn and keep running when a scan is already running", function()
		scanRunning = true
		local warnings = captureWarnings(scan)
		expect(scanRunning).to_be_truthy()
		expect(warnings).to_contain("Scan already running")
		scanRunning = false
	end)

	it("should warn and not start while a patch batch is running", function()
		patchRunning = true
		local warnings = captureWarnings(scan)
		expect(warnings).to_contain("Patch already running, cannot scan")
		expect(scanRunning).to_be_falsy()
		expect(patchRunning).to_be_truthy()
		patchRunning = false
	end)

	it("should warn and not start while a manual replacement is running", function()
		manualReplaceRunning = true
		local warnings = captureWarnings(scan)
		expect(warnings).to_contain("Manual replacement already running, cannot scan")
		expect(scanRunning).to_be_falsy()
		expect(manualReplaceRunning).to_be_truthy()
		manualReplaceRunning = false
	end)

	-- The scan body cannot complete under these mocks: stock luau has no
	-- Instance/UDim2/Enum, so setPluginGuiStatus throws inside createPluginGui.
	-- What matters for the guard is that scanRunning is restored anyway.
	it("should restore scanRunning even when the scan body fails", function()
		scanRunning = false
		patchRunning = false
		manualReplaceRunning = false

		local warnings = captureWarnings(function()
			pcall(scan)
		end)
		expect(scanRunning).to_be_falsy()
		expect(warnings).to_contain("Scan failed")
	end)
end)

describe("patcher.luau applyPatches re-entrancy guard", function()
	local somePatches = { { token = "0:missing", action = "setProperty", property = "Name" } }

	it("should warn and keep running when a batch is already running", function()
		patchRunning = true
		local warnings = captureWarnings(function()
			applyPatches(somePatches)
		end)
		expect(warnings).to_contain("Patch batch already running")
		expect(patchRunning).to_be_truthy()
		patchRunning = false
	end)

	it("should warn and skip while a scan is running", function()
		scanRunning = true
		local warnings = captureWarnings(function()
			applyPatches(somePatches)
		end)
		expect(warnings).to_contain("Scan already running; skipping patch batch")
		expect(patchRunning).to_be_falsy()
		scanRunning = false
	end)

	it("should warn and skip while a manual replacement is running", function()
		manualReplaceRunning = true
		local warnings = captureWarnings(function()
			applyPatches(somePatches)
		end)
		expect(warnings).to_contain("Manual replacement is running; skipping patch batch")
		expect(patchRunning).to_be_falsy()
		manualReplaceRunning = false
	end)

	it("should warn and skip a non-table batch", function()
		local warnings = captureWarnings(function()
			applyPatches("not a batch")
		end)
		expect(warnings).to_contain("Invalid patch batch")
		expect(patchRunning).to_be_falsy()
	end)
end)

print(string.format("\nResults: %d passed, %d failed", tests_passed, tests_failed))
if tests_failed > 0 then
	error("Test suite failed")
end
