// Menjalankan Vitest dengan huruf drive Windows yang seragam.
//
// Bila terminal dibuka di `d:\...` sementara Node me-resolve modul ke `D:\...`,
// Vitest memuat runner-nya dua kali dan setiap file test gagal dengan
// "Vitest failed to find the runner". Menyeragamkan cwd dan path CLI
// sebelum Vitest dimuat mencegah hal itu. Di luar Windows ini tidak berpengaruh.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const normalized = process.cwd().replace(/^[a-z]:/, (drive) => drive.toUpperCase());
process.chdir(normalized);

await import(pathToFileURL(resolve(normalized, "node_modules/vitest/vitest.mjs")).href);
