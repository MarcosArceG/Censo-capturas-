import { createWriteStream } from "node:fs";
import archiver from "archiver";

/**
 * Comprime todo el contenido de `dirPath` en un .zip (archivos en la raíz del zip).
 */
export function zipDirectoryToFile(dirPath, zipFilePath) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipFilePath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve(zipFilePath));
    output.on("error", reject);
    archive.on("error", reject);
    archive.on("warning", (err) => {
      if (err.code !== "ENOENT") reject(err);
    });

    archive.pipe(output);
    archive.directory(dirPath, false);
    archive.finalize();
  });
}
