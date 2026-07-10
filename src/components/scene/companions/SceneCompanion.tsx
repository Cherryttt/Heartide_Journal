import type { SceneBase } from '../sceneAssets';
import FoxCompanion from './FoxCompanion';
import SeagullCompanion from './SeagullCompanion';
import BookCompanion from './BookCompanion';
import CloudLightCompanion from './CloudLightCompanion';

export default function SceneCompanion({ base, pokeNonce }: { base: SceneBase; pokeNonce: number }) {
  switch (base) {
    case '大海': return <SeagullCompanion pokeNonce={pokeNonce} />;
    case '窗边': return <BookCompanion pokeNonce={pokeNonce} />;
    case '云海': return <CloudLightCompanion pokeNonce={pokeNonce} />;
    case '花海':
    default: return <FoxCompanion pokeNonce={pokeNonce} />;
  }
}
