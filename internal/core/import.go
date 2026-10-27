package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Configuration interchange deliberately has no credential, trust or cache fields.
type exportHost struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Address        string  `json:"address"`
	Port           int     `json:"port"`
	Username       string  `json:"username"`
	Group          string  `json:"group"`
	AuthMethod     string  `json:"authMethod"`
	PrivateKeyPath *string `json:"privateKeyPath"`
	JumpHostID     *string `json:"jumpHostId"`
}
type exportDocument struct {
	Version int          `json:"version"`
	Hosts   []exportHost `json:"hosts"`
}

func strictJSON(b []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("配置包含多余内容")
	}
	return nil
}
func normalizeImport(hosts []Host) ([]Host, error) {
	if len(hosts) > 1000 {
		return nil, fail("host_import_error", "一次最多导入 1000 个连接")
	}
	for i := range hosts {
		h := &hosts[i]
		h.RememberPassword = false
		h.RemoteSystem = nil
		if err := validateHost(h); err != nil {
			return nil, err
		}
	}
	if err := validateGraph(hosts); err != nil {
		return nil, err
	}
	return hosts, nil
}
func PreviewImport(name, format string) (ImportPreview, error) {
	b, err := readLimited(name, 4<<20)
	if err != nil {
		return ImportPreview{}, err
	}
	p := ImportPreview{Hosts: []Host{}, Warnings: []string{}}
	switch format {
	case "json":
		var doc exportDocument
		if err = strictJSON(b, &doc); err != nil {
			return p, fail("host_import_error", "配置格式无效："+err.Error())
		}
		if doc.Version != 1 {
			return p, fail("host_import_error", "不支持的配置版本")
		}
		for _, h := range doc.Hosts {
			p.Hosts = append(p.Hosts, Host{ID: h.ID, Name: h.Name, Address: h.Address, Port: h.Port, Username: h.Username, Group: h.Group, AuthMethod: h.AuthMethod, PrivateKeyPath: h.PrivateKeyPath, JumpHostID: h.JumpHostID})
		}
	case "openssh":
		p, err = parseOpenSSH(string(b))
		if err != nil {
			return p, err
		}
	default:
		return p, fail("host_import_error", "不支持的导入格式")
	}
	p.Hosts, err = normalizeImport(p.Hosts)
	return p, err
}
func (s *Store) Export(name string) error {
	if !filepath.IsAbs(name) {
		return fail("host_export_error", "导出路径必须是绝对路径")
	}
	doc := exportDocument{Version: 1, Hosts: []exportHost{}}
	for _, h := range s.Hosts() {
		doc.Hosts = append(doc.Hosts, exportHost{h.ID, h.Name, h.Address, h.Port, h.Username, h.Group, h.AuthMethod, h.PrivateKeyPath, h.JumpHostID})
	}
	b, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return err
	}
	return atomicWrite(name, append(b, '\n'))
}
func (s *Store) Import(hosts []Host) (ImportResult, error) {
	hosts, err := normalizeImport(hosts)
	if err != nil {
		return ImportResult{}, err
	}
	result := ImportResult{}
	err = s.mutate(func(d *persisted) error {
		ids := map[string]string{}
		added := []Host{}
		for _, h := range hosts {
			oldID := h.ID
			for _, existing := range append(d.Hosts, added...) {
				if existing.Address == h.Address && existing.Port == h.Port && existing.Username == h.Username {
					ids[oldID] = existing.ID
					break
				}
			}
			if ids[oldID] != "" {
				result.Skipped++
				continue
			}
			h.ID = newID()
			ids[oldID] = h.ID
			added = append(added, h)
			result.Imported++
		}
		for i := range added {
			if added[i].JumpHostID != nil {
				id := ids[*added[i].JumpHostID]
				if id == "" {
					return fail("invalid_jump_host", "找不到导入跳板机")
				}
				added[i].JumpHostID = ptr(id)
			}
		}
		d.Hosts = append(d.Hosts, added...)
		if len(d.Hosts) > 10000 {
			return fail("host_import_error", "服务器数量超出限制")
		}
		return validateGraph(d.Hosts)
	})
	if err != nil {
		return ImportResult{}, err
	}
	return result, nil
}

type sshBlock struct {
	patterns []string
	options  [][2]string
}

func sshTokens(line string) ([]string, error) {
	out := []string{}
	var token strings.Builder
	var quote rune
	escaped, active := false, false
	for _, c := range line {
		if escaped {
			token.WriteRune(c)
			escaped = false
			active = true
			continue
		}
		if c == '\\' && quote != '\'' {
			escaped = true
			active = true
			continue
		}
		if quote != 0 {
			if c == quote {
				quote = 0
			} else {
				token.WriteRune(c)
			}
			continue
		}
		if c == '\'' || c == '"' {
			quote = c
			active = true
			continue
		}
		if c == '#' {
			break
		}
		if c == ' ' || c == '\t' || c == '\r' || c == '=' && (len(out) == 0 || len(out) == 1 && !active) {
			if active {
				out = append(out, token.String())
				token.Reset()
				active = false
			}
			continue
		}
		token.WriteRune(c)
		active = true
	}
	if quote != 0 || escaped {
		return nil, fail("host_import_error", "OpenSSH 配置含未闭合引号或转义")
	}
	if active {
		out = append(out, token.String())
	}
	return out, nil
}
func sshGlob(pattern, value string) bool {
	pattern = strings.ToLower(pattern)
	value = strings.ToLower(value)
	p, v, star, retry := 0, 0, -1, 0
	for v < len(value) {
		if p < len(pattern) && (pattern[p] == '?' || pattern[p] == value[v]) {
			p++
			v++
		} else if p < len(pattern) && pattern[p] == '*' {
			star = p
			p++
			retry = v
		} else if star >= 0 {
			retry++
			v = retry
			p = star + 1
		} else {
			return false
		}
	}
	for p < len(pattern) && pattern[p] == '*' {
		p++
	}
	return p == len(pattern)
}
func sshMatches(patterns []string, alias string) bool {
	matched := false
	for _, p := range patterns {
		if strings.HasPrefix(p, "!") {
			if sshGlob(p[1:], alias) {
				return false
			}
		} else if sshGlob(p, alias) {
			matched = true
		}
	}
	return matched
}
func parseOpenSSH(contents string) (ImportPreview, error) {
	p := ImportPreview{Hosts: []Host{}, Warnings: []string{}}
	blocks := []sshBlock{{patterns: []string{"*"}}}
	aliases := []string{}
	seen := map[string]bool{}
	skip := false
	for i, line := range strings.Split(contents, "\n") {
		if i >= 20000 || len(line) > 16384 {
			return p, fail("host_import_error", "OpenSSH 配置过大")
		}
		w, err := sshTokens(line)
		if err != nil {
			return p, err
		}
		if len(w) == 0 {
			continue
		}
		key := strings.ToLower(w[0])
		if key == "host" {
			skip = false
			if len(w) < 2 || len(w) > 129 {
				return p, fail("host_import_error", "无效 Host 配置")
			}
			for _, alias := range w[1:] {
				if !strings.ContainsAny(alias, "*?!") && !seen[alias] {
					seen[alias] = true
					aliases = append(aliases, alias)
				}
			}
			blocks = append(blocks, sshBlock{patterns: w[1:]})
		} else if key == "match" {
			skip = true
			if len(p.Warnings) < 100 {
				p.Warnings = append(p.Warnings, fmt.Sprintf("第 %d 行：忽略 Match 段，不执行 exec", i+1))
			}
		} else if skip {
			continue
		} else if key == "hostname" || key == "port" || key == "user" || key == "identityfile" || key == "identitiesonly" || key == "proxyjump" {
			if len(w) != 2 {
				return p, fail("host_import_error", "OpenSSH 选项需要一个值")
			}
			blocks[len(blocks)-1].options = append(blocks[len(blocks)-1].options, [2]string{key, w[1]})
		} else if len(p.Warnings) < 100 {
			p.Warnings = append(p.Warnings, fmt.Sprintf("第 %d 行：忽略 %s，不执行命令或展开 Include", i+1, w[0]))
		}
	}
	if len(aliases) > 1000 || len(aliases)*len(blocks) > 2000000 {
		return p, fail("host_import_error", "OpenSSH 匹配规则过多")
	}
	for _, alias := range aliases {
		opts := map[string]string{}
		for _, b := range blocks {
			if sshMatches(b.patterns, alias) {
				for _, option := range b.options {
					if _, exists := opts[option[0]]; !exists {
						opts[option[0]] = option[1]
					}
				}
			}
		}
		h := Host{ID: "ssh-config:" + alias, Name: alias, Address: alias, Port: 22, Username: os.Getenv("USER"), AuthMethod: "password", Group: "SSH Config"}
		if h.Username == "" {
			h.Username = "root"
		}
		if v := opts["hostname"]; v != "" {
			h.Address = strings.ReplaceAll(v, "%h", alias)
		}
		if v := opts["user"]; v != "" {
			h.Username = v
		}
		if v := opts["port"]; v != "" {
			n, err := strconv.Atoi(v)
			if err != nil {
				return p, fail("host_import_error", "OpenSSH 端口无效")
			}
			h.Port = n
		}
		if v := opts["identityfile"]; v != "" && v != "none" {
			if strings.HasPrefix(v, "~/") {
				home, _ := os.UserHomeDir()
				v = filepath.Join(home, v[2:])
			}
			v = strings.ReplaceAll(v, "%d", func() string { home, _ := os.UserHomeDir(); return home }())
			if strings.Contains(v, "%") || !filepath.IsAbs(v) {
				return p, fail("host_import_error", "不支持的 IdentityFile 路径")
			}
			h.AuthMethod = "privateKey"
			h.PrivateKeyPath = ptr(v)
		}
		if v := opts["proxyjump"]; v != "" && v != "none" {
			if !seen[v] || strings.ContainsAny(v, ",:@") {
				return p, fail("host_import_error", "ProxyJump 仅支持当前配置中的单个主机别名")
			}
			h.JumpHostID = ptr("ssh-config:" + v)
		}
		p.Hosts = append(p.Hosts, h)
	}
	return p, nil
}
