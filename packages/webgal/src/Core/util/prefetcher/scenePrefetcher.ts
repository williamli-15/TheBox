/**
 * 场景预加载
 * @param sceneList 需要预加载的场景文件列表
 */
import { sceneFetcher } from '../../controller/scene/sceneFetcher';
import { sceneParser } from '../../parser/sceneParser';
import { logger } from '@/Core/util/logger';

import { WebGAL } from '@/Core/WebGAL';

export const scenePrefetcher = (sceneList: Array<string>): void => {
  for (const e of sceneList) {
    if (!e) continue;
    if (e.includes('/runtime/')) {
      logger.debug(`跳过运行时切片 ${e} 的预加载`);
      continue;
    }
    if (!WebGAL.sceneManager.settledScenes.includes(e)) {
      logger.info(`现在预加载场景${e}`);
      sceneFetcher(e)
        .then((r) => {
          sceneParser(r, e, e);
        })
        .catch((err) => {
          logger.warn(`预加载场景 ${e} 失败: ${err?.message ?? err}`);
        });
    } else {
      logger.warn(`场景${e}已经加载过，无需再次加载`);
    }
  }
};
