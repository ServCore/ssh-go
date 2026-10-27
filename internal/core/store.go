package core

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode"
)

type persisted struct {
	Version     int                        `json:"version"`
	Hosts       []Host                     `json:"hosts"`
	Known       []KnownHost                `json:"knownHosts"`
	Preferences map[string]json.RawMessage `json:"preferences"`
	Secrets     map[string]string          `json:"encryptedCredentials"`
}
type Store struct {
	mu     sync.Mutex
	dir    string
	data   persisted
	cipher cipher.AEAD
}

func atomicWrite(name string, data []byte) error {
	f, err := os.CreateTemp(filepath.Dir(name), ".worklane-*")
	if err != nil {
		return err
	}
	temp := f.Name()
	defer os.Remove(temp)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	cerr := f.Close()
	if err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	if err = os.Rename(temp, name); err != nil {
		return err
	}
	if d, e := os.Open(filepath.Dir(name)); e == nil {
		_ = d.Sync()
		_ = d.Close()
	}
	return nil
}
func OpenStore(dir string) (*Store, error) {
	if !filepath.IsAbs(dir) {
		return nil, fail("invalid_data_directory", "数据目录必须是绝对路径")
	}
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	for _, name := range []string{dir, filepath.Join(dir, "key"), filepath.Join(dir, "state.json")} {
		if info, e := os.Lstat(name); e == nil {
			if info.Mode()&os.ModeSymlink != 0 || name != dir && !info.Mode().IsRegular() {
				return nil, fail("invalid_data_directory", "数据目录和凭据文件不能是符号链接或特殊文件")
			}
		} else if !os.IsNotExist(e) {
			return nil, e
		}
	}
	if err := os.Chmod(dir, 0700); err != nil {
		return nil, err
	}
	raw, err := readLimited(filepath.Join(dir, "state.json"), 16<<20)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if len(raw) > 16<<20 {
		return nil, fail("storage_error", "配置文件超出大小限制")
	}
	key, err := readLimited(filepath.Join(dir, "key"), 32)
	if os.IsNotExist(err) {
		if len(raw) > 0 {
			return nil, fail("credential_error", "凭据密钥缺失，请恢复完整数据备份")
		}
		key = make([]byte, 32)
		if _, err = rand.Read(key); err != nil {
			return nil, err
		}
		if err = atomicWrite(filepath.Join(dir, "key"), key); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		clear(key)
		return nil, fail("credential_error", "凭据密钥长度无效")
	}
	block, err := aes.NewCipher(key)
	clear(key)
	if err != nil {
		return nil, fail("credential_error", "凭据密钥无效")
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	s := &Store{dir: dir, cipher: aead, data: persisted{Version: 1, Hosts: []Host{}, Known: []KnownHost{}, Preferences: map[string]json.RawMessage{}, Secrets: map[string]string{}}}
	if len(raw) > 0 {
		if err = strictJSON(raw, &s.data); err != nil || s.data.Version != 1 || s.data.Preferences == nil || s.data.Secrets == nil || s.data.Hosts == nil || s.data.Known == nil {
			return nil, fail("storage_error", "配置损坏或版本不兼容，原文件已保留")
		}
		for i := range s.data.Hosts {
			h := &s.data.Hosts[i]
			if h.ID == "" {
				return nil, fail("storage_error", "连接标识缺失")
			}
			if err = validateHost(h); err != nil {
				return nil, fail("storage_error", "保存的连接配置无效")
			}
			h.RememberPassword = s.data.Secrets[h.ID] != ""
		}
		if err = validateGraph(s.data.Hosts); err != nil {
			return nil, err
		}
	}
	for _, name := range []string{"key", "state.json"} {
		if err = os.Chmod(filepath.Join(dir, name), 0600); err != nil && !os.IsNotExist(err) {
			return nil, err
		}
	}
	return s, nil
}
func (s *Store) mutate(fn func(*persisted) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, _ := json.Marshal(s.data)
	var next persisted
	if err := json.Unmarshal(raw, &next); err != nil {
		return err
	}
	if err := fn(&next); err != nil {
		return err
	}
	raw, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return err
	}
	if len(raw) > 16<<20 {
		return fail("storage_error", "配置超出大小限制")
	}
	if err = atomicWrite(filepath.Join(s.dir, "state.json"), raw); err != nil {
		return fail("storage_error", "配置保存失败，旧记录未修改")
	}
	s.data = next
	return nil
}
func (s *Store) Hosts() []Host {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, _ := json.Marshal(s.data.Hosts)
	out := []Host{}
	_ = json.Unmarshal(raw, &out)
	return out
}
func (s *Store) Host(id string) (Host, error) {
	for _, h := range s.Hosts() {
		if h.ID == id {
			return h, nil
		}
	}
	return Host{}, fail("host_not_found", "服务器配置不存在")
}
func hasControls(s string) bool { return strings.IndexFunc(s, unicode.IsControl) >= 0 }
func validateHost(h *Host) error {
	h.Name = strings.TrimSpace(h.Name)
	h.Address = strings.TrimSpace(h.Address)
	h.Username = strings.TrimSpace(h.Username)
	h.Group = strings.TrimSpace(h.Group)
	if h.JumpHostID != nil {
		v := strings.TrimSpace(*h.JumpHostID)
		if v == "" {
			h.JumpHostID = nil
		} else {
			h.JumpHostID = ptr(v)
		}
	}
	if h.ID == "" {
		h.ID = newID()
	}
	if h.AuthMethod == "" {
		h.AuthMethod = "password"
	}
	for _, v := range []string{h.ID, h.Name, h.Address, h.Username, h.Group} {
		if len(v) > 512 || hasControls(v) {
			return fail("invalid_host", "连接字段过长或含控制字符")
		}
	}
	if h.Name == "" || h.Address == "" || h.Username == "" || h.Port < 1 || h.Port > 65535 || strings.ContainsAny(h.Address, " /\\\t") {
		return fail("invalid_host", "请填写有效的名称、地址、端口和用户名")
	}
	switch h.AuthMethod {
	case "password", "agent":
		h.PrivateKeyPath = nil
	case "privateKey":
		if h.PrivateKeyPath == nil || len(*h.PrivateKeyPath) > 4096 || !filepath.IsAbs(*h.PrivateKeyPath) || hasControls(*h.PrivateKeyPath) {
			return fail("invalid_host", "请选择有效的私钥绝对路径")
		}
	default:
		return fail("invalid_host", "不支持的认证方式")
	}
	return nil
}
func identity(a, b Host) bool {
	return a.Address == b.Address && a.Port == b.Port && a.Username == b.Username && a.AuthMethod == b.AuthMethod && str(a.PrivateKeyPath) == str(b.PrivateKeyPath) && str(a.JumpHostID) == str(b.JumpHostID)
}
func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
func validateGraph(hosts []Host) error {
	byID := map[string]Host{}
	for _, h := range hosts {
		if _, ok := byID[h.ID]; ok {
			return fail("invalid_host", "服务器标识重复")
		}
		byID[h.ID] = h
	}
	for _, h := range hosts {
		seen := map[string]bool{}
		for id := h.ID; id != ""; {
			if seen[id] || len(seen) >= 8 {
				return fail("invalid_jump_host", "跳板机链存在循环或超过 8 层")
			}
			seen[id] = true
			item, ok := byID[id]
			if !ok {
				return fail("invalid_jump_host", "跳板机不存在")
			}
			id = str(item.JumpHostID)
		}
	}
	return nil
}
func (s *Store) encrypt(id, secret string) (string, error) {
	nonce := make([]byte, s.cipher.NonceSize())
	if _, e := rand.Read(nonce); e != nil {
		return "", e
	}
	return base64.StdEncoding.EncodeToString(s.cipher.Seal(nonce, nonce, []byte(secret), []byte(id))), nil
}
func (s *Store) SaveHost(h Host, password *string) (Host, error) {
	if e := validateHost(&h); e != nil {
		return Host{}, e
	}
	if password != nil && len(*password) > 65536 {
		return Host{}, fail("invalid_host", "凭据超出大小限制")
	}
	err := s.mutate(func(d *persisted) error {
		idx := -1
		h.RemoteSystem = nil
		for i, old := range d.Hosts {
			if old.ID == h.ID {
				idx = i
				if identity(old, h) {
					h.RemoteSystem = old.RemoteSystem
				} else {
					delete(d.Secrets, h.ID)
				}
				break
			}
		}
		if h.AuthMethod == "agent" {
			delete(d.Secrets, h.ID)
		} else if password != nil && *password != "" {
			encrypted, e := s.encrypt(h.ID, *password)
			if e != nil {
				return e
			}
			d.Secrets[h.ID] = encrypted
		}
		h.RememberPassword = d.Secrets[h.ID] != ""
		if idx < 0 {
			if len(d.Hosts) >= 10000 {
				return fail("invalid_host", "服务器数量超出限制")
			}
			d.Hosts = append(d.Hosts, h)
		} else {
			d.Hosts[idx] = h
		}
		return validateGraph(d.Hosts)
	})
	return h, err
}
func (s *Store) Password(h Host) (string, error) {
	if h.AuthMethod == "agent" {
		return "", nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	v := s.data.Secrets[h.ID]
	if v == "" {
		if h.AuthMethod == "privateKey" {
			return "", nil
		}
		return "", &AppError{Code: "password_required", Message: "请输入服务器密码", Details: map[string]any{"hostId": h.ID}}
	}
	raw, e := base64.StdEncoding.DecodeString(v)
	n := s.cipher.NonceSize()
	if e != nil || len(raw) < n {
		return "", fail("credential_error", "加密凭据损坏")
	}
	plain, e := s.cipher.Open(nil, raw[:n], raw[n:], []byte(h.ID))
	if e != nil {
		return "", fail("credential_error", "无法解密服务器凭据")
	}
	defer clear(plain)
	return string(plain), nil
}
func (s *Store) saveAuthenticatedSecret(expected Host, secret string) error {
	return s.mutate(func(d *persisted) error {
		for i, h := range d.Hosts {
			if h.ID == expected.ID {
				if !identity(h, expected) {
					return fail("host_changed", "连接配置已变更，请重新连接")
				}
				if h.AuthMethod == "agent" {
					return nil
				}
				v, err := s.encrypt(h.ID, secret)
				if err != nil {
					return err
				}
				d.Secrets[h.ID] = v
				d.Hosts[i].RememberPassword = true
				return nil
			}
		}
		return fail("host_not_found", "服务器配置已删除")
	})
}
func (s *Store) DeleteHost(id string) error {
	return s.mutate(func(d *persisted) error {
		for _, h := range d.Hosts {
			if str(h.JumpHostID) == id {
				return fail("host_in_use", "此服务器仍作为跳板机使用")
			}
		}
		hosts := []Host{}
		for _, h := range d.Hosts {
			if h.ID != id {
				hosts = append(hosts, h)
			}
		}
		d.Hosts = hosts
		delete(d.Secrets, id)
		return nil
	})
}
func (s *Store) Duplicate(id string) (Host, error) {
	h, e := s.Host(id)
	if e != nil {
		return h, e
	}
	secret, e := s.Password(h)
	if e != nil {
		if a, ok := e.(*AppError); !ok || a.Code != "password_required" {
			return h, e
		}
	}
	h.ID = newID()
	base := h.Name
	names := map[string]bool{}
	for _, v := range s.Hosts() {
		names[v.Name] = true
	}
	for n := 1; ; n++ {
		h.Name = base + "（副本）"
		if n > 1 {
			h.Name = fmt.Sprintf("%s（副本 %d）", base, n)
		}
		if !names[h.Name] {
			break
		}
	}
	return s.SaveHost(h, &secret)
}
func (s *Store) Known() []KnownHost {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]KnownHost{}, s.data.Known...)
}
func (s *Store) Fingerprint(h Host) string {
	for _, k := range s.Known() {
		if k.Address == h.Address && k.Port == h.Port {
			return k.Fingerprint
		}
	}
	return ""
}
func (s *Store) Trust(h Host, fp string) error {
	if !strings.HasPrefix(fp, "SHA256:") || len(fp) > 128 || hasControls(fp) {
		return fail("invalid_host_trust", "指纹格式无效")
	}
	return s.mutate(func(d *persisted) error {
		for _, k := range d.Known {
			if k.Address == h.Address && k.Port == h.Port {
				if k.Fingerprint != fp {
					return fail("host_key_changed", "服务器指纹与已保存记录不一致")
				}
				return nil
			}
		}
		d.Known = append(d.Known, KnownHost{h.Address, h.Port, fp})
		return nil
	})
}
func (s *Store) Forget(address string, port int, fp string) error {
	return s.mutate(func(d *persisted) error {
		out := []KnownHost{}
		for _, k := range d.Known {
			if k.Address == address && k.Port == port {
				if k.Fingerprint != fp {
					return fail("host_key_conflict", "指纹已变更，请重新检查")
				}
			} else {
				out = append(out, k)
			}
		}
		d.Known = out
		return nil
	})
}
func (s *Store) Preferences() map[string]json.RawMessage {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]json.RawMessage{}
	for k, v := range s.data.Preferences {
		out[k] = append(json.RawMessage{}, v...)
	}
	return out
}
func (s *Store) SetPreference(k string, v json.RawMessage) error {
	if len(k) > 128 || len(v) > 65536 || !json.Valid(v) {
		return fail("invalid_preference", "设置无效或过大")
	}
	return s.mutate(func(d *persisted) error { d.Preferences[k] = v; return nil })
}
func readLimited(path string, n int64) ([]byte, error) {
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, n+1))
	if int64(len(b)) > n {
		return nil, errors.New("文件超出大小限制")
	}
	return b, e
}
