import { pathExists, readFile } from 'fs-extra';
import yaml from 'js-yaml';
import { logger } from '../utils/logger';

export interface ParseResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Parse a YAML file and return structured data
 */
export async function parseYamlFile(filePath: string): Promise<ParseResult> {
  try {
    if (!(await pathExists(filePath))) {
      return { success: false, error: 'File not found' };
    }

    const { readFile } = await import('fs-extra');
    const content = await readFile(filePath, 'utf-8');
    const data = yaml.load(content);
    
    return { success: true, data };
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Validate API contract YAML structure
 */
export function validateApiContract(data: any): string[] {
  const errors: string[] = [];

  if (!data) {
    errors.push('Empty YAML data');
    return errors;
  }

  // Check required fields
  if (!data.api) {
    errors.push('Missing "api" section');
  } else {
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
export function yamlToJson(data: any): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Extract API endpoints from YAML content
 */
export function extractEndpoints(data: any): Array<{ path: string; method: string }> {
  const endpoints: Array<{ path: string; method: string }> = [];
  
  if (data && data.api) {
    endpoints.push({
      path: data.api.path || '',
      method: data.api.method || 'GET'
    });
  }

  return endpoints;
}
