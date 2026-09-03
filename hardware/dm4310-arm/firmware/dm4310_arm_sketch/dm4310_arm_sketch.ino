// ============================================================================
// ForgeMind · 达妙 DM4310 六轴桌面机械臂 主程序
//
// 板卡:  ESP32 Dev Module（Arduino core for ESP32 >= 2.x，无需第三方库）
// 硬件:  GPIO4 -> SN65HVD230 TXD, GPIO5 <- RXD, 3V3/GND 共地
// 总线:  1 Mbps, 菊花链, 首尾各 120Ω 终端电阻
// 串口:  115200, 上位命令见 help
//
// 安全: 任一电机上报故障码时自动全臂失能；使能前请手扶机械臂。
// ============================================================================

#include "../dm4310_motor.h"

using namespace dm4310;

static const gpio_num_t CAN_TX_PIN = GPIO_NUM_4;
static const gpio_num_t CAN_RX_PIN = GPIO_NUM_5;

static const uint32_t CONTROL_PERIOD_MS = 10;   // 100Hz 控制周期
static const uint32_t STATUS_PERIOD_MS  = 300;
static const float    DEMO_FREQ_HZ      = 0.25f;

enum { JOINT_N = 6 };

struct JointConfig {
  const char* name;
  uint8_t can_id;        // 控制帧 ID（达妙上位机中的 CID）
  uint8_t master_id;     // 反馈帧 ID（上位机中的 MIT/MST）
  int8_t  dir;           // 装配方向: 电机正转使关节角增大为 +1, 反之为 -1
  float   limit_deg;     // 相对零点软限位
  float   kp;            // N*m/rad
  float   kd;            // N*m*s/rad
  float   demo_amp_deg;  // demo 正弦幅值, 0 = 该关节不参与
};

static JointConfig CFG[JOINT_N] = {
  {"j1_base",     0x01, 0x11, +1, 150.0f, 30.0f, 1.5f, 20.0f},
  {"j2_shoulder", 0x02, 0x12, +1, 100.0f, 35.0f, 1.5f, 15.0f},
  {"j3_elbow",    0x03, 0x13, -1, 130.0f, 25.0f, 1.2f, 15.0f},
  {"j4_wrist_p",  0x04, 0x14, -1, 110.0f, 15.0f, 0.8f, 25.0f},
  {"j5_wrist_r",  0x05, 0x15, +1, 110.0f, 10.0f, 0.5f, 25.0f},
  {"j6_end",      0x06, 0x16, +1,  90.0f,  8.0f, 0.4f, 20.0f},
};

static Range g_range = range_dm4310();
static Joint g_joints[JOINT_N] = {
  Joint(CFG[0].can_id, CFG[0].master_id, CFG[0].dir, g_range),
  Joint(CFG[1].can_id, CFG[1].master_id, CFG[1].dir, g_range),
  Joint(CFG[2].can_id, CFG[2].master_id, CFG[2].dir, g_range),
  Joint(CFG[3].can_id, CFG[3].master_id, CFG[3].dir, g_range),
  Joint(CFG[4].can_id, CFG[4].master_id, CFG[4].dir, g_range),
  Joint(CFG[5].can_id, CFG[5].master_id, CFG[5].dir, g_range),
};

static Joint*    joints[JOINT_N] = {
  &g_joints[0], &g_joints[1], &g_joints[2],
  &g_joints[3], &g_joints[4], &g_joints[5],
};
static bool      enabled_[JOINT_N] = {false};
static float     target_deg[JOINT_N] = {0};
static uint8_t   prev_err[JOINT_N] = {0};
static float     kp_scale = 1.0f, kd_scale = 1.0f;
static bool      demo_on = false;
static uint32_t  t_ctrl = 0, t_status = 0;
static char      line_buf[64];
static size_t    line_len = 0;

static void printBanner() {
  Serial.println();
  Serial.println("=== ForgeMind DM4310 6-DOF Arm ===");
  Serial.println("首次使用流程:");
  Serial.println("  1) list          查看在线状态");
  Serial.println("  2) en <all|i>    使能(务必手扶机械臂!)");
  Serial.println("  3) p <i> <deg>   小角度点动验证方向");
  Serial.println("  4) zero <all|i>  整臂摆到零位姿态后标定零点");
  Serial.println("  5) demo          正弦演示 / stop 停止回零");
  Serial.println("输入 help 查看全部命令");
}

static void printHelp() {
  Serial.println("命令列表:");
  Serial.println("  list              打印各关节角度/速度/力矩/故障");
  Serial.println("  en all | en <i>   使能(i=0..5)");
  Serial.println("  dis               全部失能");
  Serial.println("  zero all|<i>      以当前位置设为零点(先摆好姿态)");
  Serial.println("  clr               全部清除故障");
  Serial.println("  p <i> <deg>       关节定位目标角");
  Serial.println("  g <kp倍率> <kd倍率>  全局增益缩放, 如 g 0.5 1");
  Serial.println("  demo              正弦摆动开/关");
  Serial.println("  stop              demo关闭并所有目标回零");
}

static void disableAll() {
  for (int i = 0; i < JOINT_N; ++i) {
    if (enabled_[i]) { joints[i]->disable(); enabled_[i] = false; }
  }
  demo_on = false;
}

static void printStatus() {
  for (int i = 0; i < JOINT_N; ++i) {
    Joint& j = *joints[i];
    if (!j.online()) {
      Serial.printf("[%d] %-12s OFFLINE\n", i, CFG[i].name);
      continue;
    }
    Serial.printf("[%d] %-12s %s tgt=%+7.1f pos=%+7.1f vel=%+8.1f tau=%+6.2f err=%s\n",
                  i, CFG[i].name, enabled_[i] ? "EN " : "dis",
                  target_deg[i], j.posDeg(), j.velDegS(), j.tauNm(),
                  error_name(j.err()));
  }
}

static void enableJoint(int i) {
  joints[i]->clearError();
  delay(2);
  if (!joints[i]->enable()) { Serial.printf("[!] en %d 发送失败\n", i); return; }
  enabled_[i] = true;
  target_deg[i] = 0.0f;
  Serial.printf("[%d] %s 已使能并保持零位, 手扶!\n", i, CFG[i].name);
}

static bool parseIndex(const char* s, int& idx) {
  if (strcmp(s, "all") == 0) { idx = -1; return true; }
  int v = atoi(s);
  if (v < 0 || v >= JOINT_N) return false;
  idx = v;
  return true;
}

static void handleLine(char* line) {
  char* argv[5];
  int argc = 0;
  char* tok = strtok(line, " ");
  while (tok && argc < 5) { argv[argc++] = tok; tok = strtok(nullptr, " "); }
  if (argc == 0) return;
  const char* cmd = argv[0];

  if (!strcasecmp(cmd, "help")) { printHelp(); return; }
  if (!strcasecmp(cmd, "list")) { printStatus(); return; }
  if (!strcasecmp(cmd, "dis"))  { disableAll(); Serial.println("全臂已失能"); return; }

  if (!strcasecmp(cmd, "en") && argc == 2) {
    int idx;
    if (!parseIndex(argv[1], idx)) { Serial.println("参数错误"); return; }
    if (idx < 0) for (int i = 0; i < JOINT_N; ++i) enableJoint(i);
    else enableJoint(idx);
    return;
  }

  if (!strcasecmp(cmd, "zero") && argc == 2) {
    int idx;
    if (!parseIndex(argv[1], idx)) { Serial.println("参数错误"); return; }
    for (int i = 0; i < JOINT_N; ++i) {
      if (idx >= 0 && i != idx) continue;
      joints[i]->enable(); delay(10);
      joints[i]->setZero();
      joints[i]->command(0, 0, CFG[i].kp * kp_scale, CFG[i].kd * kd_scale);
      enabled_[i] = true;
      target_deg[i] = 0;
      prev_err[i] = 0;
      Serial.printf("[%d] %s 零点已保存于当前位置\n", i, CFG[i].name);
    }
    return;
  }

  if (!strcasecmp(cmd, "clr")) {
    for (int i = 0; i < JOINT_N; ++i) joints[i]->clearError();
    Serial.println("已发送清故障");
    return;
  }

  if (!strcasecmp(cmd, "p") && argc == 3) {
    int idx = atoi(argv[1]);
    float deg = atof(argv[2]);
    if (idx < 0 || idx >= JOINT_N) { Serial.println("关节编号错误"); return; }
    if (!enabled_[idx]) { Serial.println("该关节未使能, 先 en"); return; }
    target_deg[idx] = deg;
    return;
  }

  if (!strcasecmp(cmd, "g") && argc == 3) {
    kp_scale = atof(argv[1]);
    kd_scale = atof(argv[2]);
    Serial.printf("增益倍率 kp=%.2f kd=%.2f\n", kp_scale, kd_scale);
    return;
  }

  if (!strcasecmp(cmd, "demo")) { demo_on = !demo_on; Serial.println(demo_on ? "demo 开" : "demo 关"); return; }

  if (!strcasecmp(cmd, "stop")) {
    demo_on = false;
    for (int i = 0; i < JOINT_N; ++i) target_deg[i] = 0;
    Serial.println("目标已全部回零");
    return;
  }

  Serial.println("未知命令, 输入 help");
}

static void controlTick(uint32_t now_ms) {
  float t_s = now_ms / 1000.0f;
  for (int i = 0; i < JOINT_N; ++i) {
    Joint& j = *joints[i];

    if (j.online() && j.err() != 0 && prev_err[i] == 0) {
      Serial.printf("[!!] %s 故障: %s, 自动全臂失能\n", CFG[i].name, error_name(j.err()));
      disableAll();
    }
    prev_err[i] = j.err();

    if (!enabled_[i]) continue;

    float tgt = target_deg[i];
    if (demo_on && CFG[i].demo_amp_deg > 0) {
      tgt = CFG[i].demo_amp_deg * sinf(6.2831853f * DEMO_FREQ_HZ * t_s);
    }
    if (tgt >  CFG[i].limit_deg) tgt =  CFG[i].limit_deg;
    if (tgt < -CFG[i].limit_deg) tgt = -CFG[i].limit_deg;

    j.command(tgt * DEG2RAD, 0,
              CFG[i].kp * kp_scale, CFG[i].kd * kd_scale, 0.0f);
  }
}

void setup() {
  Serial.begin(115200);
  delay(400);

  if (!bus_begin(CAN_TX_PIN, CAN_RX_PIN)) {
    Serial.println("[!!] CAN 初始化失败: 检查收发器接线/引脚");
    while (true) delay(1000);
  }
  Serial.println("CAN 就绪 @1Mbps, 电机默认失能");
  printBanner();
}

void loop() {
  uint32_t now = millis();
  pump(joints, JOINT_N, now);

  if (now - t_ctrl >= CONTROL_PERIOD_MS) {
    controlTick(now);
    t_ctrl = now;
  }

  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n' || line_len >= sizeof(line_buf) - 1) {
      line_buf[line_len] = '\0';
      handleLine(line_buf);
      line_len = 0;
    } else {
      Serial.print(c);
      line_buf[line_len++] = c;
    }
  }

  if (now - t_status >= STATUS_PERIOD_MS) {
    printStatus();
    t_status = now;
  }
}