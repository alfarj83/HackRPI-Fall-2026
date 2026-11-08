export class GazeClassifier {
    constructor() {
        this.samples = [];
        this.scales = [0.20, 0.25, 0.12, 0.08];
    }

    clear() {
        this.samples = [];
    }

    count(label) {
        return this.samples.filter(
            sample => sample.label === label
        ).length;
    }

    // features contains headX, headY, gazeX, gazeY.
    addSample(features, label) {
        const values = this.toArray(features);

        if (!values) return false;

        this.samples.push({
            values,
            label
        });

        return true;
    }

    toArray(features) {
        if (!features) return null;

        const values = [
            features.headX,
            features.headY,
            features.gazeX,
            features.gazeY
        ];

        return values.every(Number.isFinite)
            ? values
            : null;
    }

    distance(a, b) {
        return Math.sqrt(
            a.reduce((sum, value, index) => {
                const delta =
                    (value - b[index]) / this.scales[index];

                return sum + delta * delta;
            }, 0)
        );
    }

    predict(features) {
        const values = this.toArray(features);

        if (!values) return "unknown";

        // Require examples of both classes.
        const labels = new Set(
            this.samples.map(sample => sample.label)
        );

        if (!labels.has("screen") ||
            !labels.has("away")) {
            return "uncalibrated";
        }

        const neighbors = this.samples
            .map(sample => ({
                label: sample.label,
                distance: this.distance(
                    values,
                    sample.values
                )
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 5);

        // Abstain if the input is unlike the calibration data.
        if (neighbors[0].distance > 2) {
            return "unknown";
        }

        const screenVotes = neighbors.filter(
            neighbor => neighbor.label === "screen"
        ).length;

        if (screenVotes >= 4) return "likely-screen";
        if (screenVotes <= 1) return "likely-away";

        return "uncertain";
    }
}