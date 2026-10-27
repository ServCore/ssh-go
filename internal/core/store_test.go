package core

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStoreEncryptsCredentialsAndPreservesTransactionalState(t *testing.T) {
	dir := t.TempDir()
	s, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	h, err := s.SaveHost(Host{Name: "server", Address: "example.test", Port: 22, Username: "user"}, ptr("secret-that-must-not-be-plaintext"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(raw, []byte("secret-that-must-not-be-plaintext")) {
		t.Fatal("plaintext password persisted")
	}
	for _, name := range []string{"key", "state.json"} {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatalf("permissions %s: %v %v", name, info, err)
		}
	}
	reopened, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	secret, err := reopened.Password(h)
	if err != nil || secret != "secret-that-must-not-be-plaintext" {
		t.Fatal("credential round trip failed", err)
	}
	copy, err := reopened.Duplicate(h.ID)
	if err != nil || copy.ID == h.ID || !copy.RememberPassword {
		t.Fatal("duplicate", copy, err)
	}
	before := reopened.Hosts()
	copy.JumpHostID = ptr(copy.ID)
	_, err = reopened.SaveHost(copy, nil)
	requireCode(t, err, "invalid_jump_host")
	if len(reopened.Hosts()) != len(before) {
		t.Fatal("failed mutation changed state")
	}
	h.Address = "different.test"
	updated, err := reopened.SaveHost(h, nil)
	if err != nil || updated.RememberPassword {
		t.Fatal("changed identity retained credential", err)
	}
	_, err = reopened.Password(updated)
	requireCode(t, err, "password_required")
	if err = os.Remove(filepath.Join(dir, "key")); err != nil {
		t.Fatal(err)
	}
	_, err = OpenStore(dir)
	requireCode(t, err, "credential_error")
	if _, err = os.Stat(filepath.Join(dir, "key")); !os.IsNotExist(err) {
		t.Fatal("missing key silently regenerated")
	}
}
func TestStoreRejectsSymlinksAndCorruptState(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "target")
	_ = os.Mkdir(target, 0755)
	link := filepath.Join(dir, "link")
	if err := os.Symlink(target, link); err != nil {
		t.Fatal(err)
	}
	_, err := OpenStore(link)
	requireCode(t, err, "invalid_data_directory")
	info, _ := os.Stat(target)
	if info.Mode().Perm() != 0755 {
		t.Fatal("symlink target permissions were changed")
	}
	s, err := OpenStore(filepath.Join(dir, "store"))
	if err != nil {
		t.Fatal(err)
	}
	bad := []byte(`{"version":99}`)
	_ = os.WriteFile(filepath.Join(s.dir, "state.json"), bad, 0600)
	_, err = OpenStore(s.dir)
	requireCode(t, err, "storage_error")
	raw, _ := os.ReadFile(filepath.Join(s.dir, "state.json"))
	if !bytes.Equal(raw, bad) {
		t.Fatal("corrupt state overwritten")
	}
}
func TestConfigurationImportExportRemapsJumpsWithoutSecrets(t *testing.T) {
	e := newTestEngine(t, nil)
	jump := saveTestHost(t, e, Host{ID: "jump", Name: "jump", Address: "jump.test", Port: 22, Username: "user"}, ptr("hidden"))
	target := saveTestHost(t, e, Host{ID: "target", Name: "target", Address: "target.test", Port: 22, Username: "user", JumpHostID: ptr(jump.ID)}, ptr("other-secret"))
	_ = e.Store.Trust(target, "SHA256:test")
	name := filepath.Join(t.TempDir(), "hosts.json")
	if err := e.Store.Export(name); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(name)
	for _, forbidden := range []string{"hidden", "other-secret", "rememberPassword", "knownHosts", "encryptedCredentials", "remoteSystem"} {
		if bytes.Contains(raw, []byte(forbidden)) {
			t.Fatalf("export contains %s", forbidden)
		}
	}
	preview, err := PreviewImport(name, "json")
	if err != nil || len(preview.Hosts) != 2 {
		t.Fatal(preview, err)
	}
	imported := newTestEngine(t, nil)
	existing := saveTestHost(t, imported, jump, nil)
	result, err := imported.Store.Import(preview.Hosts)
	if err != nil || result.Imported != 1 || result.Skipped != 1 {
		t.Fatal(result, err)
	}
	hosts := imported.Store.Hosts()
	if hosts[1].ID == target.ID || str(hosts[1].JumpHostID) != existing.ID || hosts[1].RememberPassword {
		t.Fatal("imported jump IDs/credentials incorrect", hosts)
	}
	_ = os.WriteFile(name, []byte(`{"version":1,"hosts":[],"password":"forbidden"}`), 0600)
	_, err = PreviewImport(name, "json")
	requireCode(t, err, "host_import_error")
	if err = imported.Store.SetPreference("theme", json.RawMessage(`"dark"`)); err != nil {
		t.Fatal(err)
	}
	if string(imported.Store.Preferences()["theme"]) != `"dark"` {
		t.Fatal("preferences not retained")
	}
}
func TestOpenSSHImportsSafeSubsetAndFirstValueRules(t *testing.T) {
	config := "Host *.example !excluded.example\n User first\nHost jump.example\n HostName jump.test\n Port 2200\n IdentityFile '/keys/key with spaces'\nHost target.example\n HostName target.test\n User ignored\n ProxyJump jump.example\nHost excluded.example\n User independent\nHost *\n User fallback\n Include /must-not-be-read\n ProxyCommand touch /must-not-be-created\nMatch exec 'never execute'\n User ignored-too\n"
	p, err := parseOpenSSH(config)
	if err != nil {
		t.Fatal(err)
	}
	hosts, err := normalizeImport(p.Hosts)
	if err != nil {
		t.Fatal(err)
	}
	if len(hosts) != 3 || hosts[0].Username != "first" || hosts[0].Port != 2200 || hosts[0].AuthMethod != "privateKey" || str(hosts[0].PrivateKeyPath) != "/keys/key with spaces" || str(hosts[1].JumpHostID) != hosts[0].ID || hosts[2].Username != "independent" || len(p.Warnings) != 3 {
		t.Fatal(p)
	}
	for _, invalid := range []string{"Host one\n Port nope\n", "Host one\n ProxyJump missing\n", "Host one\n IdentityFile 'unclosed\n"} {
		if _, err = parseOpenSSH(invalid); err == nil {
			t.Fatalf("invalid config accepted: %s", invalid)
		}
	}
	p, err = parseOpenSSH("Host one\n User user\n ProxyJump two\nHost two\n User user\n ProxyJump one\n")
	if err != nil {
		t.Fatal(err)
	}
	_, err = normalizeImport(p.Hosts)
	requireCode(t, err, "invalid_jump_host")
	tokens, err := sshTokens("IdentityFile='/a/#key' # ignored")
	if err != nil || strings.Join(tokens, "|") != "IdentityFile|/a/#key" {
		t.Fatal(tokens, err)
	}
}
