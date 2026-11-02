import { generateChunk } from "../../shared/scenario";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      id: data.id,
      chunk: generateChunk(data.config, data.start, data.end),
    });
  } catch (e) {
    self.postMessage({ id: data.id, error: String(e) });
  }
};
