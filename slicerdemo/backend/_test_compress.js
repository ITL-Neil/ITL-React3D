
import { readFileSync, writeFileSync } from "fs";
import { Document, NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import { meshopt } from "@gltf-transform/functions";

const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
const doc = await io.read(process.argv[2]);
await doc.transform(meshopt({ encoder: 1 }));
const glb = await io.writeBinary(doc);
writeFileSync(process.argv[3], glb);
console.log("compressed OK");
