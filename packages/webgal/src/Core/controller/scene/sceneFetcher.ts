import axios from 'axios';
import { getRuntimeSessionId, SESSION_HEADER } from '@/Core/gameState';

/**
 * 原始场景文件获取函数
 * @param sceneUrl 场景文件路径
 */
export const sceneFetcher = (sceneUrl: string) => {
  return new Promise<string>((resolve, reject) => {
    axios
      .get(sceneUrl, {
        headers: {
          [SESSION_HEADER]: getRuntimeSessionId(),
        },
      })
      .then((response) => {
        const rawScene: string = response.data.toString();
        resolve(rawScene);
      })
      .catch((e) => {
        reject(e);
      });
  });
};
