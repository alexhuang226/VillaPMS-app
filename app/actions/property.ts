"use server";

import { getAllPropertiesSettings, updatePropertySettings } from "@/lib/pricing/queries";
import type { PropertySettingsDetail, PropertySettingsFields } from "@/lib/pricing/queries";

export async function getAllPropertiesSettingsAction(): Promise<PropertySettingsDetail[]> {
  return getAllPropertiesSettings();
}

export async function updatePropertySettingsAction(propertyId: string, fields: PropertySettingsFields): Promise<void> {
  return updatePropertySettings(propertyId, fields);
}
