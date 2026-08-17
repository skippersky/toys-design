# Hardware-adaptive AI deployment

The deployment scripts detect the best NVIDIA GPU through `nvidia-smi`, select an AI profile, install the matching PyTorch build and checkpoint, and write the selected generation parameters to `.env.local`.

Model weights and runtimes stay under `.runtime/`. They are not committed to Git or copied into the Next.js application bundle.

## Automatic profiles

| Profile              | Selection                           | Backend and model                  | Default generation           |
| -------------------- | ----------------------------------- | ---------------------------------- | ---------------------------- |
| `cuda-sdxl-high`     | NVIDIA VRAM >= 20 GB                | CUDA 12.4, SDXL Base 1.0           | 1024x1024, 25 steps, CFG 7   |
| `cuda-sdxl-standard` | NVIDIA VRAM >= 12 GB                | CUDA 12.4, SDXL Base 1.0           | 1024x1024, 22 steps, CFG 6.5 |
| `cuda-sdxl-low`      | NVIDIA VRAM >= 8 GB                 | CUDA 12.4, SDXL Base 1.0, low VRAM | 768x768, 18 steps, CFG 6     |
| `cuda-lcm-lite`      | NVIDIA VRAM < 8 GB                  | CUDA 12.4, DreamShaper 8 LCM       | 512x512, 6 steps, CFG 2      |
| `directml-lcm-lite`  | Windows without working NVIDIA CUDA | DirectML, DreamShaper 8 LCM        | 384x384, 4 steps, CFG 2      |
| `cpu-lcm-lite`       | Linux without NVIDIA, or forced CPU | CPU, DreamShaper 8 LCM             | 384x384, 4 steps, CFG 2      |

An RTX 3090 24 GB is expected to select `cuda-sdxl-high`.

The resolved profile is recorded at:

- Windows: `.runtime/ai-profile.json`
- Linux: `.runtime/ai-profile.env`

Generation asset metadata also records `deployment_profile`.

## Windows one-click deployment

Requirements:

- Windows 10 or 11 x64
- NVIDIA driver 550+ recommended for the CUDA 12.4 profile
- Git and internet access on the first run
- Approximately 20 GB free for the SDXL/CUDA profile

Double-click `setup-and-start.cmd`, or run:

```powershell
.\setup-and-start.cmd
```

The automatic launcher:

1. Detects NVIDIA model, VRAM, and driver with `nvidia-smi`.
2. Falls back to DirectML when CUDA is unavailable.
3. Installs isolated Python 3.11, pinned ComfyUI, and matching PyTorch.
4. Downloads the selected checkpoint with resume and SHA256 verification.
5. Installs portable Node.js/pnpm when the system commands are unavailable.
6. Writes model, sampler, scheduler, dimensions, steps, and CFG to `.env.local`.
7. Starts ComfyUI and Next.js after health checks pass.

Force a backend when diagnosing a machine:

```powershell
.\setup-and-start.cmd -ComfyMode cuda
.\setup-and-start.cmd -ComfyMode directml
.\setup-and-start.cmd -ComfyMode cpu
```

Individual Windows commands:

```powershell
pnpm ai:install
pnpm ai:start
pnpm ai:health
pnpm ai:stop
```

## Linux one-click deployment

The Linux scripts target x86_64 Ubuntu/Debian or RHEL/Fedora-family servers. Missing base tools are installed with `apt-get` or `dnf`; non-root users need `sudo`.

Automatic development deployment:

```bash
bash setup-and-start.sh
```

Production deployment on an NVIDIA server:

```bash
bash setup-and-start.sh --production
```

Force CUDA or CPU:

```bash
bash setup-and-start.sh --mode cuda --production
bash setup-and-start.sh --mode cpu --production
```

Individual Linux commands:

```bash
pnpm ai:install:linux -- --mode auto
pnpm ai:start:linux
pnpm ai:health:linux
pnpm ai:stop:linux
```

The Next.js process listens on `0.0.0.0`; ComfyUI remains private on `127.0.0.1:8188`. Put the application behind the server's normal TLS reverse proxy.

## Dynamic application values

The launcher manages these values without touching Supabase credentials:

```dotenv
COMFYUI_CHECKPOINT_NAME="..."
COMFYUI_SAMPLER_NAME="..."
COMFYUI_SCHEDULER="..."
AI_DEPLOYMENT_PROFILE="..."
NEXT_PUBLIC_AI_DEPLOYMENT_PROFILE="..."
NEXT_PUBLIC_AI_DEFAULT_STEPS="..."
NEXT_PUBLIC_AI_DEFAULT_CFG="..."
NEXT_PUBLIC_AI_SQUARE_WIDTH="..."
NEXT_PUBLIC_AI_SQUARE_HEIGHT="..."
NEXT_PUBLIC_AI_LANDSCAPE_WIDTH="..."
NEXT_PUBLIC_AI_LANDSCAPE_HEIGHT="..."
NEXT_PUBLIC_AI_PORTRAIT_WIDTH="..."
NEXT_PUBLIC_AI_PORTRAIT_HEIGHT="..."
```

Restart Next.js after changing profiles because `NEXT_PUBLIC_*` values are compiled into the browser bundle.

## Pinned supply chain

- ComfyUI: `v0.3.59` / `72212fef660bcd7d9702fa52011d089c027a64d8`
- Python on Windows: `3.11.9`
- Portable Node.js / pnpm: `22.16.0 / 10.12.1`
- PyTorch / torchvision / torchaudio: `2.4.1 / 0.19.1 / 2.4.1`
- CUDA wheel channel: `cu124`
- DirectML: `torch-directml 0.2.5.dev240914`
- NumPy: `1.26.4`
- Transformers / Tokenizers: `4.49.0 / 0.21.4`
- DreamShaper checkpoint SHA256: `A4F3E1526C5DC4FCBE342F5C410D83AE202C7A415FCEFCBB92E0F93FCD0A87C3`
- SDXL Base 1.0 checkpoint SHA256: `31E35C80FC4829D14F90153F4C74CD59C90B779F6AFE05A74CD6120B893F7E5B`
- Windows Node archive SHA256: `21C2D9735C80B8F86DAB19305AA6A9F6F59BBC808F68DE3EEF09D5832E3BFBBD`
- Linux Node archive SHA256: `F4CB75BB036F0D0EDDF6B79D9596DF1AAAB9DDCCD6A20BF489BE5ABE9467E84E`

Model licenses are not replaced by the application license. Review `THIRD_PARTY_NOTICES.md` before redistributing a package that includes downloaded weights.
