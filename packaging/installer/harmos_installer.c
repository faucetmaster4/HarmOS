/*
 * HarmOS-Installer.exe — Native Windows x86_64 (and POSIX) Appliance Installer
 * Edition : HarmOS Nexus — VirtualBox Edition (0.1.0-alpha)
 * Build   : x86_64-w64-mingw32-gcc -O2 -Wall -Wextra -s harmos_installer.c -o HarmOS-Installer.exe -ladvapi32 -luser32
 *
 * Implements:
 *   1. auto_install()   — Host-resource-aware unattended VirtualBox OVA import + NAT hardening
 *   2. manual_install() — Interactive step-by-step configuration wizard
 *   3. sha256_file()    — Streaming FIPS 180-4 SHA-256 appliance integrity verification
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <ctype.h>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <io.h>
#define ACCESS_FN _access
#define F_OK_VAL 0
#else
#include <unistd.h>
#define ACCESS_FN access
#define F_OK_VAL F_OK
#endif

#define HARMOS_VERSION "0.1.0"
#define DEFAULT_OVA    "HarmOS-0.1.0-x86_64.ova"
#define DEFAULT_VM     "HarmOS-0.1.0"

/* ---------------- FIPS 180-4 SHA-256 (streaming, zero external deps) ---------------- */

typedef struct {
    uint32_t state[8];
    uint64_t bitcount;
    uint8_t  buffer[64];
} sha256_ctx;

static const uint32_t K256[64] = {
    0x428a2f98u,0x71374491u,0xb5c0fbcfu,0xe9b5dba5u,0x3956c25bu,0x59f111f1u,0x923f82a4u,0xab1c5ed5u,
    0xd807aa98u,0x12835b01u,0x243185beu,0x550c7dc3u,0x72be5d74u,0x80deb1feu,0x9bdc06a7u,0xc19bf174u,
    0xe49b69c1u,0xefbe4786u,0x0fc19dc6u,0x240ca1ccu,0x2de92c6fu,0x4a7484aau,0x5cb0a9dcu,0x76f988dau,
    0x983e5152u,0xa831c66du,0xb00327c8u,0xbf597fc7u,0xc6e00bf3u,0xd5a79147u,0x06ca6351u,0x14292967u,
    0x27b70a85u,0x2e1b2138u,0x4d2c6dfcu,0x53380d13u,0x650a7354u,0x766a0abbu,0x81c2c92eu,0x92722c85u,
    0xa2bfe8a1u,0xa81a664bu,0xc24b8b70u,0xc76c51a3u,0xd192e819u,0xd6990624u,0xf40e3585u,0x106aa070u,
    0x19a4c116u,0x1e376c08u,0x2748774cu,0x34b0bcb5u,0x391c0cb3u,0x4ed8aa4au,0x5b9cca4fu,0x682e6ff3u,
    0x748f82eeu,0x78a5636fu,0x84c87814u,0x8cc70208u,0x90befffau,0xa4506cebu,0xbef9a3f7u,0xc67178f2u
};

static uint32_t rotr32(uint32_t x, uint32_t n) { return (x >> n) | (x << (32u - n)); }

static void sha256_transform(sha256_ctx *ctx, const uint8_t data[64]) {
    uint32_t w[64], a, b, c, d, e, f, g, h, t1, t2;
    int i;
    for (i = 0; i < 16; ++i) {
        w[i] = ((uint32_t)data[i * 4] << 24) | ((uint32_t)data[i * 4 + 1] << 16) |
               ((uint32_t)data[i * 4 + 2] << 8) | ((uint32_t)data[i * 4 + 3]);
    }
    for (i = 16; i < 64; ++i) {
        uint32_t s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >> 3);
        uint32_t s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    a = ctx->state[0]; b = ctx->state[1]; c = ctx->state[2]; d = ctx->state[3];
    e = ctx->state[4]; f = ctx->state[5]; g = ctx->state[6]; h = ctx->state[7];
    for (i = 0; i < 64; ++i) {
        uint32_t S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
        uint32_t ch = (e & f) ^ ((~e) & g);
        t1 = h + S1 + ch + K256[i] + w[i];
        uint32_t S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
        uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
        t2 = S0 + maj;
        h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
    }
    ctx->state[0] += a; ctx->state[1] += b; ctx->state[2] += c; ctx->state[3] += d;
    ctx->state[4] += e; ctx->state[5] += f; ctx->state[6] += g; ctx->state[7] += h;
}

static void sha256_init(sha256_ctx *ctx) {
    ctx->state[0] = 0x6a09e667u; ctx->state[1] = 0xbb67ae85u;
    ctx->state[2] = 0x3c6ef372u; ctx->state[3] = 0xa54ff53au;
    ctx->state[4] = 0x510e527fu; ctx->state[5] = 0x9b05688cu;
    ctx->state[6] = 0x1f83d9abu; ctx->state[7] = 0x5be0cd19u;
    ctx->bitcount = 0;
}

static void sha256_update(sha256_ctx *ctx, const uint8_t *data, size_t len) {
    size_t idx = (size_t)((ctx->bitcount >> 3) & 0x3fu);
    ctx->bitcount += (uint64_t)len << 3;
    size_t i = 0;
    if (idx) {
        size_t left = 64 - idx;
        if (len < left) { memcpy(ctx->buffer + idx, data, len); return; }
        memcpy(ctx->buffer + idx, data, left);
        sha256_transform(ctx, ctx->buffer);
        i = left;
    }
    for (; i + 64 <= len; i += 64) sha256_transform(ctx, data + i);
    if (i < len) memcpy(ctx->buffer, data + i, len - i);
}

static void sha256_final(sha256_ctx *ctx, char hex_out[65]) {
    size_t idx = (size_t)((ctx->bitcount >> 3) & 0x3fu);
    ctx->buffer[idx++] = 0x80u;
    if (idx > 56) {
        memset(ctx->buffer + idx, 0, 64 - idx);
        sha256_transform(ctx, ctx->buffer);
        idx = 0;
    }
    memset(ctx->buffer + idx, 0, 56 - idx);
    for (int i = 0; i < 8; ++i) ctx->buffer[56 + i] = (uint8_t)(ctx->bitcount >> (56 - i * 8));
    sha256_transform(ctx, ctx->buffer);
    for (int i = 0; i < 8; ++i) snprintf(hex_out + i * 8, 9, "%08x", ctx->state[i]);
    hex_out[64] = '\0';
}

static int sha256_file(const char *path, char hex_out[65]) {
    FILE *fp = fopen(path, "rb");
    if (!fp) return -1;
    sha256_ctx ctx;
    sha256_init(&ctx);
    uint8_t buf[65536];
    size_t n;
    while ((n = fread(buf, 1, sizeof(buf), fp)) > 0) sha256_update(&ctx, buf, n);
    int err = ferror(fp);
    fclose(fp);
    if (err) return -1;
    sha256_final(&ctx, hex_out);
    return 0;
}

/* ---------------- Host Resource & VirtualBox Detection ---------------- */

typedef struct {
    char vbox_exe[512];
    char ova_path[512];
    char expected_sha[128];
    char vm_name[128];
    char net_mode[32];
    char clipboard[32];
    char share_dir[512];
    int  ram_mb;
    int  cpus;
    int  dry_run;
    int  start_vm;
    int  interactive_gui;
} install_cfg;

static void detect_host_specs(int *host_ram_mb, int *host_cpus, int *rec_ram, int *rec_cpus) {
    *host_ram_mb = 8192;
    *host_cpus = 4;
#ifdef _WIN32
    MEMORYSTATUSEX ms;
    ms.dwLength = sizeof(ms);
    if (GlobalMemoryStatusEx(&ms)) *host_ram_mb = (int)(ms.ullTotalPhys / (1024ULL * 1024ULL));
    SYSTEM_INFO si;
    GetSystemInfo(&si);
    if (si.dwNumberOfProcessors > 0) *host_cpus = (int)si.dwNumberOfProcessors;
#else
    long pages = sysconf(_SC_PHYS_PAGES);
    long psize = sysconf(_SC_PAGE_SIZE);
    if (pages > 0 && psize > 0) *host_ram_mb = (int)(((uint64_t)pages * (uint64_t)psize) / (1024ULL * 1024ULL));
    long ncpu = sysconf(_SC_NPROCESSORS_ONLN);
    if (ncpu > 0) *host_cpus = (int)ncpu;
#endif
    *rec_ram = *host_ram_mb / 2;
    if (*rec_ram < 4096) *rec_ram = 4096;
    if (*rec_ram > 8192) *rec_ram = 8192;
    *rec_cpus = *host_cpus / 2;
    if (*rec_cpus < 2) *rec_cpus = 2;
    if (*rec_cpus > 4) *rec_cpus = 4;
}

static int file_exists(const char *p) { return p && *p && ACCESS_FN(p, F_OK_VAL) == 0; }

static int find_vboxmanage(char out[512]) {
#ifdef _WIN32
    const char *msi = getenv("VBOX_MSI_INSTALL_PATH");
    if (msi && *msi) {
        snprintf(out, 512, "%sVBoxManage.exe", msi);
        if (file_exists(out)) return 1;
        snprintf(out, 512, "%s\\VBoxManage.exe", msi);
        if (file_exists(out)) return 1;
    }
    const char *pf = getenv("ProgramFiles");
    if (pf && *pf) {
        snprintf(out, 512, "%s\\Oracle\\VirtualBox\\VBoxManage.exe", pf);
        if (file_exists(out)) return 1;
    }
    char regdir[384] = {0};
    DWORD sz = sizeof(regdir);
    if (RegGetValueA(HKEY_LOCAL_MACHINE, "SOFTWARE\\Oracle\\VirtualBox", "InstallDir",
                     RRF_RT_REG_SZ, NULL, regdir, &sz) == ERROR_SUCCESS && regdir[0]) {
        snprintf(out, 512, "%sVBoxManage.exe", regdir);
        if (file_exists(out)) return 1;
    }
    if (SearchPathA(NULL, "VBoxManage.exe", NULL, 512, out, NULL) > 0) return 1;
#else
    const char *cands[] = { "/usr/bin/VBoxManage", "/usr/local/bin/VBoxManage",
        "/Applications/VirtualBox.app/Contents/MacOS/VBoxManage", NULL };
    for (int i = 0; cands[i]; ++i) {
        if (file_exists(cands[i])) { snprintf(out, 512, "%s", cands[i]); return 1; }
    }
#endif
    return 0;
}

static void read_line(const char *prompt, char *buf, size_t sz, const char *def) {
    printf("%s [%s]: ", prompt, def);
    fflush(stdout);
    if (!fgets(buf, (int)sz, stdin)) { snprintf(buf, sz, "%s", def); return; }
    size_t len = strlen(buf);
    while (len > 0 && (buf[len - 1] == '\n' || buf[len - 1] == '\r')) buf[--len] = '\0';
    if (len == 0) snprintf(buf, sz, "%s", def);
}

static int verify_ova(const install_cfg *cfg) {
    if (!file_exists(cfg->ova_path)) {
        fprintf(stderr, "[ fail ] OVA file not found: %s\n", cfg->ova_path);
        return -1;
    }
    printf("[harmos] Computing FIPS 180-4 SHA-256 of '%s' ...\n", cfg->ova_path);
    char actual[65];
    if (sha256_file(cfg->ova_path, actual) != 0) {
        fprintf(stderr, "[ fail ] Unable to read OVA file for hashing.\n");
        return -1;
    }
    char expected[128] = {0};
    if (cfg->expected_sha[0]) {
        const char *p = strncmp(cfg->expected_sha, "sha256:", 7) == 0 ? cfg->expected_sha + 7 : cfg->expected_sha;
        snprintf(expected, sizeof(expected), "%s", p);
    } else {
        char sidecar_sha[540];
        snprintf(sidecar_sha, sizeof(sidecar_sha), "%s.sha256", cfg->ova_path);
        FILE *fp = fopen(sidecar_sha, "r");
        if (fp) {
            if (fscanf(fp, "%120s", expected) != 1) expected[0] = '\0';
            fclose(fp);
        }
    }
    for (int i = 0; expected[i]; ++i) expected[i] = (char)tolower((unsigned char)expected[i]);

    if (expected[0]) {
        if (strcmp(actual, expected) != 0) {
            fprintf(stderr, "[ fail ] SHA-256 MISMATCH!\n         Expected: %s\n         Actual  : %s\n", expected, actual);
            return -1;
        }
        printf("[  ok  ] SHA-256 verified: %s\n", actual);
    } else {
        printf("[ warn ] No .sha256 companion file found; computed digest: %s\n", actual);
    }
    return 0;
}

static int run_cmd(const install_cfg *cfg, const char *args) {
    char full[2048];
#ifdef _WIN32
    /* cmd.exe /S /C requires outer quotes when both executable and arguments are quoted */
    snprintf(full, sizeof(full), "\"\"%s\" %s\"", cfg->vbox_exe, args);
#else
    snprintf(full, sizeof(full), "\"%s\" %s", cfg->vbox_exe, args);
#endif
    if (cfg->dry_run) {
        printf("  [dry-run] \"%s\" %s\n", cfg->vbox_exe, args);
        return 0;
    }
    printf("[ exec ] \"%s\" %s\n", cfg->vbox_exe, args);
    int rc = system(full);
    if (rc != 0) fprintf(stderr, "[ fail ] Command exited with status %d\n", rc);
    return rc;
}

static int execute_pipeline(const install_cfg *cfg) {
    if (!cfg->dry_run || file_exists(cfg->ova_path)) {
        if (verify_ova(cfg) != 0) return 1;
    } else {
        printf("[ warn ] Dry-run mode: skipping disk check for '%s'\n", cfg->ova_path);
    }

    char cmd[1400];
    snprintf(cmd, sizeof(cmd), "import \"%s\" --vsys 0 --vmname \"%s\" --cpus %d --memory %d",
             cfg->ova_path, cfg->vm_name, cfg->cpus, cfg->ram_mb);
    if (run_cmd(cfg, cmd) != 0) return 1;

    snprintf(cmd, sizeof(cmd), "modifyvm \"%s\" --nic1 %s --vrde off --draganddrop disabled --clipboard-mode %s --graphicscontroller vmsvga --vram 128 --audio-driver none --rtcuseutc on",
             cfg->vm_name, cfg->net_mode, cfg->clipboard);
    if (run_cmd(cfg, cmd) != 0) return 1;

    if (cfg->share_dir[0]) {
        snprintf(cmd, sizeof(cmd), "sharedfolder add \"%s\" --name host-share --hostpath \"%s\" --readonly --automount",
                 cfg->vm_name, cfg->share_dir);
        if (run_cmd(cfg, cmd) != 0) return 1;
    }

    printf("[  ok  ] HarmOS appliance '%s' ready (%d vCPUs, %d MB RAM, net=%s, VRDE=off).\n",
           cfg->vm_name, cfg->cpus, cfg->ram_mb, cfg->net_mode);

    if (cfg->start_vm) {
        snprintf(cmd, sizeof(cmd), "startvm \"%s\" --type gui", cfg->vm_name);
        if (run_cmd(cfg, cmd) != 0) return 1;
    }
    return 0;
}

/* 1. AUTO INSTALL FUNCTION */
static int auto_install(install_cfg *cfg) {
    int hram = 0, hcpu = 0, rram = 0, rcpu = 0;
    detect_host_specs(&hram, &hcpu, &rram, &rcpu);
    if (cfg->ram_mb <= 0) cfg->ram_mb = rram;
    if (cfg->cpus <= 0) cfg->cpus = rcpu;
    snprintf(cfg->net_mode, sizeof(cfg->net_mode), "nat");
    snprintf(cfg->clipboard, sizeof(cfg->clipboard), "bidirectional");
    cfg->share_dir[0] = '\0';

    printf("[harmos] AUTO INSTALL: Host=%d cores / %d MB RAM -> Guest=%d vCPUs / %d MB RAM (NAT isolated)\n",
           hcpu, hram, cfg->cpus, cfg->ram_mb);
    return execute_pipeline(cfg);
}

/* 2. MANUAL INSTALL FUNCTION */
static int manual_install(install_cfg *cfg) {
    int hram = 0, hcpu = 0, rram = 0, rcpu = 0;
    detect_host_specs(&hram, &hcpu, &rram, &rcpu);
    char buf[512], def[64];

    printf("\n--- HarmOS %s Manual Installation Wizard ---\n", HARMOS_VERSION);
    read_line("1. Path to HarmOS OVA", cfg->ova_path, sizeof(cfg->ova_path), cfg->ova_path);
    read_line("2. VirtualBox VM Name", cfg->vm_name, sizeof(cfg->vm_name), cfg->vm_name);

    snprintf(def, sizeof(def), "%d", cfg->cpus > 0 ? cfg->cpus : rcpu);
    read_line("3. Guest vCPUs (min 2)", buf, sizeof(buf), def);
    cfg->cpus = atoi(buf) > 0 ? atoi(buf) : rcpu;

    snprintf(def, sizeof(def), "%d", cfg->ram_mb > 0 ? cfg->ram_mb : rram);
    read_line("4. Guest RAM in MB (min 4096)", buf, sizeof(buf), def);
    cfg->ram_mb = atoi(buf) >= 2048 ? atoi(buf) : rram;

    read_line("5. Network mode (nat / hostonly / none)", cfg->net_mode, sizeof(cfg->net_mode), "nat");
    read_line("6. Clipboard mode (bidirectional / hosttoguest / disabled)", cfg->clipboard, sizeof(cfg->clipboard), "bidirectional");
    read_line("7. Optional read-only shared folder (blank for none)", cfg->share_dir, sizeof(cfg->share_dir), "");
    if (strcmp(cfg->share_dir, "") == 0) cfg->share_dir[0] = '\0';

    read_line("8. Boot HarmOS immediately after import? (y/N)", buf, sizeof(buf), "N");
    cfg->start_vm = (buf[0] == 'y' || buf[0] == 'Y') ? 1 : 0;

    printf("\nSummary: VM='%s' | OVA='%s' | %d vCPUs | %d MB RAM | net=%s | clipboard=%s\n",
           cfg->vm_name, cfg->ova_path, cfg->cpus, cfg->ram_mb, cfg->net_mode, cfg->clipboard);
    read_line("Proceed with import? (y/N)", buf, sizeof(buf), "Y");
    if (buf[0] != 'y' && buf[0] != 'Y') {
        printf("[harmos] Cancelled by operator.\n");
        return 1;
    }
    return execute_pipeline(cfg);
}

static void print_help(void) {
    printf("HarmOS-Installer %s — Auto & Manual VirtualBox Appliance Installer\n\n"
           "Usage:\n"
           "  HarmOS-Installer.exe                    Interactive console menu\n"
           "  HarmOS-Installer.exe --auto [options]   Unattended host-tuned install\n"
           "  HarmOS-Installer.exe --manual [options] Custom step-by-step wizard\n"
           "  HarmOS-Installer.exe --verify           Verify OVA SHA-256 digest only\n\n"
           "Options:\n"
           "  --ova <file>      Path to HarmOS-0.1.0-x86_64.ova\n"
           "  --sha256 <hex>    Expected SHA-256 digest\n"
           "  --name <vm>       VirtualBox VM name (default: %s)\n"
           "  --ram <mb>        Guest RAM in MB\n"
           "  --cpus <n>        Guest vCPU count\n"
           "  --start           Boot VM after import\n"
           "  --dry-run         Print VBoxManage commands without executing\n",
           HARMOS_VERSION, DEFAULT_VM);
}

int main(int argc, char **argv) {
    install_cfg cfg;
    memset(&cfg, 0, sizeof(cfg));
    snprintf(cfg.ova_path, sizeof(cfg.ova_path), "%s", DEFAULT_OVA);
    snprintf(cfg.vm_name, sizeof(cfg.vm_name), "%s", DEFAULT_VM);
    snprintf(cfg.net_mode, sizeof(cfg.net_mode), "nat");
    snprintf(cfg.clipboard, sizeof(cfg.clipboard), "bidirectional");

    const char *mode = NULL;
    for (int i = 1; i < argc; ++i) {
        if (strcmp(argv[i], "--auto") == 0) mode = "auto";
        else if (strcmp(argv[i], "--manual") == 0) mode = "manual";
        else if (strcmp(argv[i], "--verify") == 0) mode = "verify";
        else if (strcmp(argv[i], "--dry-run") == 0) cfg.dry_run = 1;
        else if (strcmp(argv[i], "--start") == 0) cfg.start_vm = 1;
        else if (strcmp(argv[i], "--ova") == 0 && i + 1 < argc) snprintf(cfg.ova_path, sizeof(cfg.ova_path), "%s", argv[++i]);
        else if (strcmp(argv[i], "--sha256") == 0 && i + 1 < argc) snprintf(cfg.expected_sha, sizeof(cfg.expected_sha), "%s", argv[++i]);
        else if (strcmp(argv[i], "--name") == 0 && i + 1 < argc) snprintf(cfg.vm_name, sizeof(cfg.vm_name), "%s", argv[++i]);
        else if (strcmp(argv[i], "--ram") == 0 && i + 1 < argc) cfg.ram_mb = atoi(argv[++i]);
        else if (strcmp(argv[i], "--cpus") == 0 && i + 1 < argc) cfg.cpus = atoi(argv[++i]);
        else if (strcmp(argv[i], "-h") == 0 || strcmp(argv[i], "--help") == 0) { print_help(); return 0; }
        else { fprintf(stderr, "Unknown argument: %s\n", argv[i]); print_help(); return 1; }
    }

    if (mode && strcmp(mode, "verify") == 0) {
        return verify_ova(&cfg) == 0 ? 0 : 1;
    }

    if (!find_vboxmanage(cfg.vbox_exe)) {
        if (cfg.dry_run) {
            snprintf(cfg.vbox_exe, sizeof(cfg.vbox_exe), "VBoxManage.exe");
            printf("[ warn ] VBoxManage not installed on this host — continuing in --dry-run mode.\n");
        } else {
            fprintf(stderr, "[ fail ] Oracle VirtualBox (VBoxManage) not found.\n"
                            "         Install VirtualBox 7.x+ from https://www.virtualbox.org/ or pass --dry-run.\n");
#ifdef _WIN32
            if (argc == 1) {
                MessageBoxA(NULL,
                    "Oracle VirtualBox (VBoxManage.exe) was not found on this Windows system.\n\n"
                    "Please install Oracle VirtualBox 7.0 or newer from https://www.virtualbox.org/ "
                    "and re-run HarmOS-Installer.exe.",
                    "HarmOS Installer — VirtualBox Required", MB_ICONWARNING | MB_OK);
            }
#endif
            return 1;
        }
    }

    if (!mode) {
        char choice[32];
        printf("\n============================================================\n"
               "  HarmOS %s — Native Appliance Installer (Auto / Manual)\n"
               "============================================================\n"
               "  [1] Auto Install    (Recommended: host-tuned + NAT isolation)\n"
               "  [2] Manual Install  (Custom vCPUs, RAM, network, shares)\n"
               "  [3] Verify OVA      (FIPS 180-4 SHA-256 integrity check)\n"
               "  [4] Dry-Run Preview (Print VBoxManage commands only)\n"
               "  [q] Quit\n\n", HARMOS_VERSION);
        read_line("Select mode", choice, sizeof(choice), "1");
        if (choice[0] == '1') mode = "auto";
        else if (choice[0] == '2') mode = "manual";
        else if (choice[0] == '3') return verify_ova(&cfg) == 0 ? 0 : 1;
        else if (choice[0] == '4') { cfg.dry_run = 1; mode = "auto"; }
        else return 0;
    }

    int rc = strcmp(mode, "manual") == 0 ? manual_install(&cfg) : auto_install(&cfg);
#ifdef _WIN32
    if (argc == 1) {
        printf("\nPress ENTER to close...");
        fflush(stdout);
        getchar();
    }
#endif
    return rc;
}
