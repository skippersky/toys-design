# Hardware-adaptive deployment evidence

Date: 2026-08-17

## Profile resolution

```text
[Current Windows workstation]
profile=directml-lcm-lite
checkpoint=DreamShaper8_LCM.safetensors
steps=4 cfg=2 dimensions=512x512

[Simulated NVIDIA GeForce RTX 3090 / 24576 MB]
profile=cuda-sdxl-high
backend=CUDA 12.4
checkpoint=sd_xl_base_1.0.safetensors
sampler=dpmpp_2m scheduler=karras
steps=25 cfg=7 dimensions=1024x1024
```

The PowerShell and Bash detectors produced the same RTX 3090 profile.

## Runtime verification

```text
[Windows profile start] directml-lcm-lite
[ComfyUI] HTTP 200
[ComfyUI argv] --directml --lowvram
[Checkpoint] DreamShaper8_LCM.safetensors
[Next.js] HTTP 200
[Supabase RPC probe] HTTP 200
[Unauthenticated generation guard] HTTP 401
```

## Quality gates

```text
PowerShell parser: 6 deployment scripts, PASS
Bash -n: 7 deployment scripts, PASS
ESLint: PASS, 0 issues
Vitest: PASS, 19 files / 52 tests
Next.js production build: PASS
Step 5 service probe: PASS
```

The Linux installer was syntax-validated from Git Bash on Windows. A real CUDA
package download and SDXL inference must still be run on the target RTX 3090 or
Linux NVIDIA host; this workstation has no NVIDIA device.
