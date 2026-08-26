"use server";

import { getRoomConfigPricing, updateRoomConfigPricing } from "@/lib/pricing/rate-editor";
import type { RoomConfigPriceUpdate, RoomConfigPricing } from "@/lib/pricing/rate-editor";

export async function getRoomConfigPricingAction(propertyId: string): Promise<RoomConfigPricing[]> {
  return getRoomConfigPricing(propertyId);
}

export async function updateRoomConfigPricingAction(update: RoomConfigPriceUpdate): Promise<void> {
  return updateRoomConfigPricing(update);
}
