"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseYamlFile = parseYamlFile;
exports.validateApiContract = validateApiContract;
exports.yamlToJson = yamlToJson;
exports.extractEndpoints = extractEndpoints;
const fs_extra_1 = require("fs-extra");
const js_yaml_1 = __importDefault(require("js-yaml"));
/**
 * Parse a YAML file and return structured data
 */
async function parseYamlFile(filePath) {
    try {
        if (!(await (0, fs_extra_1.pathExists)(filePath))) {
            return { success: false, error: 'File not found' };
        }
        const { readFile } = await Promise.resolve().then(() => __importStar(require('fs-extra')));
        const content = await readFile(filePath, 'utf-8');
        const data = js_yaml_1.default.load(content);
        return { success: true, data };
    }
    catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}
/**
 * Validate API contract YAML structure
 */
function validateApiContract(data) {
    const errors = [];
    if (!data) {
        errors.push('Empty YAML data');
        return errors;
    }
    // Check required fields
    if (!data.api) {
        errors.push('Missing "api" section');
    }
    else {
        if (!data.api.path) {
            errors.push('Missing API path');
        }
        if (!data.api.method) {
            errors.push('Missing API method');
        }
    }
    if (!data.request) {
        errors.push('Missing "request" section');
    }
    if (!data.response) {
        errors.push('Missing "response" section');
    }
    return errors;
}
/**
 * Convert YAML to JSON string
 */
function yamlToJson(data) {
    return JSON.stringify(data, null, 2);
}
/**
 * Extract API endpoints from YAML content
 */
function extractEndpoints(data) {
    const endpoints = [];
    if (data && data.api) {
        endpoints.push({
            path: data.api.path || '',
            method: data.api.method || 'GET'
        });
    }
    return endpoints;
}
//# sourceMappingURL=yaml-parser.js.map