type ChannelVideoAsset = {
  assetId: string | null;
};

/**
 * The transfer-all action is complete only when every distinct channel-video
 * asset has a corresponding Management content item.
 */
export function areAllChannelVideosTransferred(
  channelVideos: readonly ChannelVideoAsset[],
  transferredByAssetId: Readonly<Record<string, string>>
): boolean {
  const assetIds = new Set(
    channelVideos
      .map((video) => video.assetId)
      .filter((assetId): assetId is string => Boolean(assetId))
  );

  return (
    assetIds.size > 0 &&
    Array.from(assetIds).every((assetId) => Boolean(transferredByAssetId[assetId]))
  );
}
