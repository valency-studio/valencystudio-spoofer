import type { PluginAsset } from './pluginBridge';
import type { ParsedAssetRef, RbxInstance } from './robloxPlaceParser/types';

export const getAssetId = (
  asset: ParsedAssetRef | { id?: string; assetId?: string; name?: string },
): string => {
  if ('assetId' in asset && asset.assetId) return asset.assetId;
  if ('id' in asset && asset.id) return asset.id;
  return '';
};

export function compactSingleChildFolders(nodes: RbxInstance[]): RbxInstance[] {
  return nodes.map((node) => {
    let current = node;
    const isRootService =
      [
        'Workspace',
        'ReplicatedStorage',
        'Lighting',
        'ServerScriptService',
        'ServerStorage',
        'StarterGui',
        'StarterPack',
        'StarterPlayer',
        'SoundService',
        'MaterialService',
        'StudioSession',
        'Place',
      ].includes(current.className) ||
      ['Workspace', 'ReplicatedStorage', 'Lighting', 'ReplicatedFirst', 'Studio Session'].includes(
        current.name,
      );

    if (!isRootService) {
      while (current.assets.length === 0 && current.children.length === 1) {
        const onlyChild = current.children[0];
        current = {
          ...onlyChild,
          referent: `${current.referent}->${onlyChild.referent}`,
          name: `${current.name} / ${onlyChild.name}`,
        };
      }
    }

    return {
      ...current,
      children: compactSingleChildFolders(current.children),
    };
  });
}

export function buildDataModelTree(
  allAssets: { asset: PluginAsset; type: ParsedAssetRef['type'] }[],
): RbxInstance[] {
  const nodeMap = new Map<string, RbxInstance>();
  const rootNodes: RbxInstance[] = [];

  const getOrCreateNode = (pathParts: string[], className?: string): RbxInstance => {
    const fullPath = pathParts.join('.');
    if (nodeMap.has(fullPath)) {
      const existing = nodeMap.get(fullPath)!;
      if (className && (existing.className === 'Folder' || existing.className === 'Instance')) {
        existing.className = className;
      }
      return existing;
    }

    const name = pathParts[pathParts.length - 1];
    let resolvedClass = className || 'Folder';
    if (pathParts.length === 1) {
      resolvedClass = name;
    }

    const newNode: RbxInstance = {
      referent: `datamodel-${fullPath}`,
      className: resolvedClass,
      name,
      assets: [],
      children: [],
    };
    nodeMap.set(fullPath, newNode);

    if (pathParts.length === 1) {
      rootNodes.push(newNode);
    } else {
      const parentParts = pathParts.slice(0, pathParts.length - 1);
      const parentNode = getOrCreateNode(parentParts);
      parentNode.children.push(newNode);
    }

    return newNode;
  };

  for (const item of allAssets) {
    const a = item.asset;
    const rawPath = a.fullName || a.script || a.name || 'Workspace';
    const parts = rawPath.split('.').filter(Boolean);
    if (parts.length === 0) continue;

    const isScriptRef = item.type === 'script_ref';
    const targetNode = isScriptRef
      ? getOrCreateNode(parts.length > 1 ? parts.slice(0, -1) : parts, 'Script')
      : getOrCreateNode(parts, a.kind || undefined);

    const assetId = a.assetId ?? '';
    const propName = a.property ?? a.callType ?? a.sourceHint ?? '';

    if (
      targetNode.assets.some(
        (ref) => ref.assetId === assetId && ref.propertyName === propName && ref.type === item.type,
      )
    ) {
      continue;
    }

    const isAliasProperty =
      (propName === 'AnimationContent' &&
        targetNode.assets.some((r) => r.propertyName === 'AnimationId')) ||
      (propName === 'AudioContent' &&
        targetNode.assets.some((r) => r.propertyName === 'SoundId')) ||
      (propName === 'MeshContent' && targetNode.assets.some((r) => r.propertyName === 'MeshId'));
    if (isAliasProperty) {
      continue;
    }

    targetNode.assets.push({
      type: item.type,
      assetId,
      rawValue: `rbxassetid://${assetId}`,
      className: a.kind ?? targetNode.className,
      instanceName: a.name ?? parts[parts.length - 1] ?? assetId,
      propertyName: propName,
      path: rawPath,
    });
  }

  return compactSingleChildFolders(rootNodes);
}
