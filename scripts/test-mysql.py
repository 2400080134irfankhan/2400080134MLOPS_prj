"""Run the MySQL integration suites and verify an actual database restart."""
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import time
import uuid


def main():
    root = Path(__file__).resolve().parent.parent
    name = "fraud-test-" + uuid.uuid4().hex
    password = secrets.token_hex(32)
    env = dict(os.environ, MYSQL_ROOT_PASSWORD=password, MYSQL_DATABASE="fraud_sentinel_seed_test")
    pnpm = shutil.which("pnpm.cmd" if os.name == "nt" else "pnpm")
    if not pnpm:
        raise RuntimeError("Install pnpm and Node before running the test")

    def run(*args, capture=False):
        result = subprocess.run(args, cwd=root, env=env, capture_output=True, timeout=180)
        if not capture or result.returncode:
            print((result.stdout + result.stderr).decode(errors="replace").replace(password, "[redacted]"), flush=True)
        result.check_returncode()
        return result.stdout.strip()

    def wait_for_mysql():
        for _ in range(90):
            result = subprocess.run(["docker", "exec", name, "sh", "-ec",
                'test "$(cat /proc/1/comm)" = mysqld && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "SELECT 1"'],
                capture_output=True, timeout=10)
            if result.returncode == 0:
                return
            time.sleep(1)
        raise RuntimeError("Disposable MySQL did not become ready")

    def snapshot():
        return run("docker", "exec", name, "sh", "-ec",
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --no-tablespaces --skip-comments '
            '--no-create-info --skip-triggers --order-by-primary --compact '
            'fraud_sentinel_operations_test transactions scoring_requests pipeline_state model_versions model_runs model_deployment_state model_artifacts audit_events', capture=True)

    # Docker allocates an anonymous volume for this new container alone.
    run("docker", "run", "-d", "--rm", "--name", name, "-p", "127.0.0.1::3306",
        "-e", "MYSQL_ROOT_PASSWORD", "-e", "MYSQL_DATABASE", "mysql:8.4", capture=True)
    try:
        wait_for_mysql()
        run("docker", "exec", name, "sh", "-ec",
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -e "CREATE DATABASE fraud_sentinel_operations_test"')
        port = run("docker", "port", name, "3306/tcp", capture=True).decode().rsplit(":", 1)[1]
        for variable, database in [("SEED_TEST_DATABASE_URL", "fraud_sentinel_seed_test"),
                                   ("OPERATIONS_TEST_DATABASE_URL", "fraud_sentinel_operations_test")]:
            env[variable] = env["DATABASE_URL"] = f"mysql://root:{password}@127.0.0.1:{port}/{database}"
            run(pnpm, "db:migrate")
        run(pnpm, "test")
        before = snapshot()
        if b"INSERT INTO `scoring_requests`" not in before:
            raise RuntimeError("No persisted scoring sample to verify")
        run("docker", "restart", name, capture=True)
        wait_for_mysql()
        if snapshot() != before:
            raise RuntimeError("Stored rows changed after restarting MySQL")
        print("MySQL restart verified for stream, scores, pipeline, model registry, artifacts and audits.")
    finally:
        run("docker", "stop", name, capture=True)


if __name__ == "__main__":
    main()
