export interface AttributeItem {
  prefix?: string;
  name: string;
  value: string;
  isEventListener: boolean;
  isSubProperty: boolean;
}

export type AttributeValueFormatter = (value: string, attributeName?: string, tagName?: string, attributes?) => string;