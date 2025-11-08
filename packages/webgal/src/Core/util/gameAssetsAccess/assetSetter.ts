import { getGameAssetPath } from '@/Core/gameState';

/**
 * @file 资源的引入可能是绝对链接，也可能是文件名，必须做必要的处理。
 */

/**
 * 内置资源类型的枚举
 */
export enum fileType {
  background,
  bgm,
  figure,
  scene,
  tex,
  vocal,
  video,
}

/**
 * 获取资源路径
 * @param fileName 资源的名称或地址
 * @param assetType 资源类型
 * @return {string} 处理后的资源路径（绝对或相对）
 */
export const assetSetter = (fileName: string, assetType: fileType): string => {
  // 是绝对链接，直接返回
  if (fileName.match('http://') || fileName.match('https://')) {
    return fileName;
  }

  switch (assetType) {
    case fileType.background:
      return getGameAssetPath(`background/${fileName}`);
    case fileType.scene:
      return getGameAssetPath(`scene/${fileName}`);
    case fileType.vocal:
      return getGameAssetPath(`vocal/${fileName}`);
    case fileType.figure:
      return getGameAssetPath(`figure/${fileName}`);
    case fileType.bgm:
      return getGameAssetPath(`bgm/${fileName}`);
    case fileType.video:
      return getGameAssetPath(`video/${fileName}`);
    case fileType.tex:
      return getGameAssetPath(`tex/${fileName}`);
    default:
      return getGameAssetPath(fileName);
  }
};
